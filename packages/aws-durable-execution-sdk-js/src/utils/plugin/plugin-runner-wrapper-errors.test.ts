import { createPluginRunner } from "./plugin-runner";
import type {
  CustomerFn,
  DurableInstrumentationPlugin,
} from "../../types/plugin";
import type { AttemptInfo } from "../../types/plugin";

const info: AttemptInfo = {
  id: "step",
  name: "work",
  type: "STEP",
  isReplay: false,
  attempt: 1,
};

function run(plugins: DurableInstrumentationPlugin[], fn: CustomerFn): unknown {
  return createPluginRunner(plugins).wrapOperationAttemptFn!(info, fn);
}

describe("wrapper recovery and callback ownership", () => {
  it("reuses the healthy inner wrapper's transformed result after repeated next and a throw", () => {
    const original = { result: "original" };
    const value = { result: "healthy wrapper result" };
    const body = jest.fn(() => original);
    const inner = jest.fn((_info, next: CustomerFn) => {
      expect(next()).toBe(original);
      return value;
    });
    const result = run(
      [
        {
          wrapOperationAttemptFn(_info, next) {
            expect(next()).toBe(next());
            throw new Error("plugin failed after next");
          },
        },
        { wrapOperationAttemptFn: inner },
      ],
      body,
    );
    expect(result).toBe(value);
    expect(body).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("memoizes a synchronous callback error across repeated next and recovery", () => {
    const original = new Error("customer failure");
    const errors: unknown[] = [];
    const body = jest.fn(() => {
      throw original;
    });
    const inner = jest.fn((_info, next: CustomerFn) => next());
    let escaped: unknown;
    try {
      run(
        [
          {
            wrapOperationAttemptFn(_info, next) {
              for (let i = 0; i < 2; i++) {
                try {
                  next();
                } catch (error) {
                  errors.push(error);
                }
              }
              throw new Error("plugin replacement error");
            },
          },
          { wrapOperationAttemptFn: inner },
        ],
        body,
      );
    } catch (error) {
      escaped = error;
    }
    expect(escaped).toBe(original);
    expect(errors).toEqual([original, original]);
    expect(body).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("retains an observed asynchronous customer error when the wrapper rethrows a replacement", async () => {
    const original = new Error("customer failure");
    const body = jest.fn(async () => {
      throw original;
    });
    const value = run(
      [
        {
          async wrapOperationAttemptFn(_info, next) {
            try {
              await next();
            } catch {
              throw new Error("plugin replacement error");
            }
          },
        },
      ],
      body,
    );
    await expect(value).rejects.toBe(original);
    expect(body).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "reject"])(
    "reads a wrapper then method once, retains its receiver and ignores a late throw (%s)",
    async (settlement) => {
      const result = { value: "callback" };
      const override = { value: "override" };
      const body = jest.fn(() => result);
      let reads = 0;
      let calls = 0;
      // biome-ignore lint/suspicious/noThenProperty: Exercise thenable assimilation and a throwing then callback.
      const thenable = Object.defineProperty({}, "then", {
        get() {
          reads++;
          return function (
            this: unknown,
            resolve: (value: unknown) => void,
            reject: (error: unknown) => void,
          ) {
            expect(this).toBe(thenable);
            calls++;
            if (settlement === "resolve") resolve(override);
            else reject(new Error("plugin rejection"));
            throw new Error("ignored after settlement");
          };
        },
      });
      const value = await run(
        [{ wrapOperationAttemptFn: () => thenable }],
        body,
      );
      expect(value).toBe(settlement === "resolve" ? override : result);
      expect(body).toHaveBeenCalledTimes(settlement === "resolve" ? 0 : 1);
      expect(reads).toBe(1);
      expect(calls).toBe(1);
    },
  );

  it.each([false, true])(
    "recursively assimilates wrapper thenables and contains an inner getter failure (failure=%s)",
    async (failure) => {
      const callbackValue = { value: "callback" };
      const override = { value: "override" };
      const body = jest.fn(() => callbackValue);
      const healthy = jest.fn((_info, next: CustomerFn) => next());
      let reads = 0;
      // biome-ignore lint/suspicious/noThenProperty: Exercise recursive PromiseLike resolution, including its error path.
      const inner = Object.defineProperty({}, "then", {
        get() {
          reads++;
          if (failure) throw new Error("nested instrumentation getter");
          return function (this: unknown, resolve: (value: unknown) => void) {
            expect(this).toBe(inner);
            resolve(override);
          };
        },
      });
      const value = await run(
        [
          {
            wrapOperationAttemptFn: () => ({
              // biome-ignore lint/suspicious/noThenProperty: An outer thenable resolves to another thenable.
              then(resolve: (value: unknown) => void) {
                resolve(inner);
              },
            }),
          },
          { wrapOperationAttemptFn: healthy },
        ],
        body,
      );
      expect(value).toBe(failure ? callbackValue : override);
      expect(reads).toBe(1);
      expect(healthy).toHaveBeenCalledTimes(failure ? 1 : 0);
      expect(body).toHaveBeenCalledTimes(failure ? 1 : 0);
    },
  );

  it.each([false, true])(
    "accepts callback thenables without .catch (failure=%s)",
    async (failure) => {
      const result = { value: "callback" };
      const original = new Error("customer thenable failure");
      const thenable = {
        // biome-ignore lint/suspicious/noThenProperty: Exercise public PromiseLike interop without Promise.catch.
        then(
          resolve: (value: unknown) => void,
          reject: (error: unknown) => void,
        ) {
          queueMicrotask(() => (failure ? reject(original) : resolve(result)));
        },
      };
      const value = Promise.resolve(
        run(
          [{ wrapOperationAttemptFn: (_info, next) => next() }],
          () => thenable,
        ),
      );
      if (failure) await expect(value).rejects.toBe(original);
      else await expect(value).resolves.toBe(result);
    },
  );

  it.each(["then", "constructor"])(
    "keeps callback observation private when a wrapper mutates next().%s",
    async (property) => {
      const result = { value: "callback" };
      const body = jest.fn(() => Promise.resolve(result));
      const inner = jest.fn((_info, next: CustomerFn) => next());
      const value = await run(
        [
          {
            wrapOperationAttemptFn(_info, next) {
              const exposed = next();
              Object.defineProperty(exposed, property, {
                get() {
                  throw new Error(`mutated ${property}`);
                },
              });
              return exposed;
            },
          },
          { wrapOperationAttemptFn: inner },
        ],
        body,
      );
      expect(value).toBe(result);
      expect(body).toHaveBeenCalledTimes(1);
      expect(inner).toHaveBeenCalledTimes(1);
    },
  );

  it("returns a synchronous override without waiting for a started callback", () => {
    const body = jest.fn(() => new Promise(() => {}));
    const value = run(
      [
        {
          wrapOperationAttemptFn(_info, next) {
            void next();
            return "override";
          },
        },
      ],
      body,
    );
    expect(value).toBe("override");
    expect(body).toHaveBeenCalledTimes(1);
  });

  it("observes a later callback rejection after a synchronous override", async () => {
    let reject!: (error: unknown) => void;
    const callback = new Promise((_resolve, fail) => {
      reject = fail;
    });
    const body = jest.fn(() => callback);
    const value = run(
      [
        {
          wrapOperationAttemptFn(_info, next) {
            void next();
            return "override";
          },
        },
      ],
      body,
    );
    expect(value).toBe("override");
    reject(new Error("late customer failure"));
    // Let the rejection reach the runner's observation handlers. Jest also
    // fails the test if it becomes an unhandled rejection.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(body).toHaveBeenCalledTimes(1);
  });

  it.each(["slow", "never"])(
    "lets a 50ms resolve-deadline wrapper finish while next is %s",
    async (mode) => {
      let bodyTimer: ReturnType<typeof setTimeout> | undefined;
      let guardTimer: ReturnType<typeof setTimeout> | undefined;
      let completed = false;
      const callback = new Promise((resolve) => {
        if (mode === "slow")
          bodyTimer = setTimeout(() => {
            completed = true;
            resolve("callback");
          }, 1000);
      });
      const body = jest.fn(() => callback);
      try {
        const value = run(
          [
            {
              wrapOperationAttemptFn: (_info, next) =>
                Promise.race([
                  next(),
                  new Promise((resolve) =>
                    setTimeout(() => resolve("timed-out"), 50),
                  ),
                ]),
            },
          ],
          body,
        );
        const bounded = await Promise.race([
          Promise.resolve(value),
          new Promise((resolve) => {
            guardTimer = setTimeout(() => resolve("still-pending"), 500);
          }),
        ]);
        expect(bounded).toBe("timed-out");
        expect(completed).toBe(false);
        expect(body).toHaveBeenCalledTimes(1);
      } finally {
        clearTimeout(bodyTimer);
        clearTimeout(guardTimer);
      }
    },
  );

  it("preserves an undefined short circuit without entering next", () => {
    const body = jest.fn(() => "must not run");
    expect(
      run([{ wrapOperationAttemptFn: () => undefined }], body),
    ).toBeUndefined();
    expect(body).not.toHaveBeenCalled();
  });

  it("keeps a distinct transformed result when next's then becomes non-callable", async () => {
    const original = { value: "callback" };
    const transformed = { value: "wrapper" };
    const body = jest.fn(() => Promise.resolve(original));
    const value = await run(
      [
        {
          wrapOperationAttemptFn(_info, next) {
            const promise = next();
            // biome-ignore lint/suspicious/noThenProperty: The identity shortcut must not replace a different wrapper result.
            Object.defineProperty(promise, "then", { value: undefined });
            return Promise.resolve(transformed);
          },
        },
      ],
      body,
    );
    expect(value).toBe(transformed);
    expect(body).toHaveBeenCalledTimes(1);
  });
});
