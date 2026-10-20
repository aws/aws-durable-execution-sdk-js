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

  it.each(
    [1, 2, 3].flatMap((layers) =>
      [...new Set([0, layers - 1])].flatMap((overrideIndex) =>
        [0, 1, 2].map((ticks) => ({ layers, overrideIndex, ticks })),
      ),
    ),
  )(
    "chooses asynchronous override precedence at source settlement (layers=$layers, override=$overrideIndex, callbackTicks=$ticks)",
    async ({ layers, overrideIndex, ticks }) => {
      const original = new Error("customer failure");
      const body = jest.fn(async () => {
        for (let i = 0; i < ticks; i++) await 0;
        throw original;
      });
      const wrappers = Array.from({ length: layers }, (_, index) =>
        jest.fn((_info, next: CustomerFn) => {
          if (index !== overrideIndex) return next();
          void (next() as Promise<unknown>).catch(() => undefined);
          return Promise.resolve("override");
        }),
      );
      const value = run(
        wrappers.map((wrapOperationAttemptFn) => ({ wrapOperationAttemptFn })),
        body,
      );
      if (ticks === 0) await expect(value).rejects.toBe(original);
      else await expect(value).resolves.toBe("override");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(body).toHaveBeenCalledTimes(1);
      for (const wrap of wrappers) expect(wrap).toHaveBeenCalledTimes(1);
    },
  );

  it.each(
    ["native", "wrapper-thenable", "callback-thenable"].flatMap((form) =>
      [0, 1, 2, 3, 4, 5].map((ticks) => ({ form, ticks })),
    ),
  )(
    "preserves main's native await depth in outer wrappers (form=$form, callbackTicks=$ticks)",
    async ({ form, ticks }) => {
      const original = new Error("customer failure");
      const forward = (source: Promise<unknown>) => ({
        // biome-ignore lint/suspicious/noThenProperty: A forwarding PromiseLike is supported alongside native promises.
        then(
          resolve: (value: unknown) => unknown,
          reject?: (error: unknown) => unknown,
        ) {
          return source.then(resolve, reject);
        },
        catch(reject: (error: unknown) => unknown) {
          return source.catch(reject);
        },
      });
      const body = jest.fn(() => {
        const promise = (async () => {
          for (let i = 0; i < ticks; i++) await 0;
          throw original;
        })();
        return form === "callback-thenable" ? forward(promise) : promise;
      });
      const outer = jest.fn(async (_info, next: CustomerFn) => await next());
      const inner = jest.fn((_info, next: CustomerFn) => {
        void (next() as Promise<unknown>).catch(() => undefined);
        const override = Promise.resolve("override");
        return form === "wrapper-thenable" ? forward(override) : override;
      });
      const value = run(
        [{ wrapOperationAttemptFn: outer }, { wrapOperationAttemptFn: inner }],
        body,
      );
      if (ticks >= (form === "wrapper-thenable" ? 4 : 2)) {
        await expect(value).resolves.toBe("override");
      } else {
        await expect(value).rejects.toBe(original);
      }
      expect(body).toHaveBeenCalledTimes(1);
      expect(outer).toHaveBeenCalledTimes(1);
      expect(inner).toHaveBeenCalledTimes(1);
    },
  );

  it.each(
    [1, 2, 3].flatMap((layers) =>
      [layers + 3, layers + 4].map((ticks) => ({ layers, ticks })),
    ),
  )(
    "preserves adopted PromiseLike await depth (layers=$layers, callbackTicks=$ticks)",
    async ({ layers, ticks }) => {
      const original = new Error("customer failure");
      const body = jest.fn(async () => {
        for (let i = 0; i < ticks; i++) await 0;
        throw original;
      });
      const then = jest.fn((resolve: (value: unknown) => unknown) =>
        resolve(Promise.resolve("override")),
      );
      const inner = jest.fn((_info, next: CustomerFn) => {
        void (next() as Promise<unknown>).catch(() => undefined);
        // biome-ignore lint/suspicious/noThenProperty: Adoption must preserve the outer await's ordering without a second source subscription.
        return { then };
      });
      const outers = Array.from({ length: layers }, () =>
        jest.fn(async (_info, next: CustomerFn) => await next()),
      );
      const value = run(
        [...outers, inner].map((wrapOperationAttemptFn) => ({
          wrapOperationAttemptFn,
        })),
        body,
      );
      if (ticks === layers + 3) await expect(value).rejects.toBe(original);
      else await expect(value).resolves.toBe("override");
      expect(then).toHaveBeenCalledTimes(1);
      expect(body).toHaveBeenCalledTimes(1);
      expect(inner).toHaveBeenCalledTimes(1);
      for (const outer of outers) expect(outer).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["await", "return-mutated", "throw", "await-mutated"])(
    "observes a wrapper PromiseLike once and protects recovery from outer %s",
    async (mode) => {
      const body = jest.fn(async () => "body");
      const then = jest.fn(function (
        this: unknown,
        resolve: (value: unknown) => unknown,
        reject: (error: unknown) => unknown,
      ) {
        expect(this).toBe(source);
        return transformed.then(resolve, reject);
      });
      // biome-ignore lint/suspicious/noThenProperty: The source must only be subscribed once, even when an outer wrapper fails.
      const source = { then };
      let transformed: Promise<unknown>;
      const inner = jest.fn((_info, next: CustomerFn) => {
        transformed = (next() as Promise<unknown>).then(
          (value) => `inner:${value}`,
        );
        return source;
      });
      const outer = jest.fn((_info, next: CustomerFn) => {
        const exposed = next();
        if (mode === "throw") throw new Error("outer plugin failure");
        if (mode !== "await") {
          // biome-ignore lint/suspicious/noThenProperty: A broken outer wrapper must not corrupt the private cached outcome.
          Object.defineProperty(exposed, "then", {
            get() {
              throw new Error("mutated outer observation");
            },
          });
        }
        if (mode === "return-mutated") return exposed;
        return (async () => await exposed)();
      });
      await expect(
        run(
          [
            { wrapOperationAttemptFn: outer },
            { wrapOperationAttemptFn: inner },
          ],
          body,
        ),
      ).resolves.toBe("inner:body");
      expect(then).toHaveBeenCalledTimes(1);
      expect(body).toHaveBeenCalledTimes(1);
      expect(inner).toHaveBeenCalledTimes(1);
      expect(outer).toHaveBeenCalledTimes(1);
    },
  );

  it.each(
    [false, true].flatMap((startInner) =>
      [false, true].map((callbackFails) => ({ startInner, callbackFails })),
    ),
  )(
    "unwinds outer wrappers and recovers cached work after an async plugin failure (started=$startInner, callbackFails=$callbackFails)",
    async ({ startInner, callbackFails }) => {
      const original = new Error("customer failure");
      const body = jest.fn(async () => {
        if (callbackFails) throw original;
        return "body";
      });
      const finalized = jest.fn();
      const postAwait = jest.fn();
      const outer = jest.fn(async (_info, next: CustomerFn) => {
        try {
          const value = await next();
          postAwait();
          return value;
        } finally {
          finalized();
        }
      });
      const inner = jest.fn(async (_info, next: CustomerFn) => {
        if (startInner) {
          try {
            await next();
          } catch {
            /* Preserve the original error in the SDK. */
          }
        }
        throw new Error("plugin failure");
      });
      const value = run(
        [{ wrapOperationAttemptFn: outer }, { wrapOperationAttemptFn: inner }],
        body,
      );
      if (callbackFails) await expect(value).rejects.toBe(original);
      else await expect(value).resolves.toBe("body");
      expect(body).toHaveBeenCalledTimes(1);
      expect(inner).toHaveBeenCalledTimes(1);
      expect(outer).toHaveBeenCalledTimes(1);
      expect(finalized).toHaveBeenCalledTimes(1);
      expect(postAwait).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "retains the settlement chosen by a synchronous thenable (callbackRejectsImmediately=%s)",
    async (immediate) => {
      const original = new Error("customer failure");
      const body = jest.fn(async () => {
        if (!immediate) await 0;
        throw original;
      });
      const value = run(
        [
          {
            wrapOperationAttemptFn(_info, next) {
              void (next() as Promise<unknown>).catch(() => undefined);
              return {
                // biome-ignore lint/suspicious/noThenProperty: Synchronous PromiseLike settlement precedes queued callback rejection.
                then(resolve: (value: unknown) => unknown) {
                  return resolve("override");
                },
              };
            },
          },
        ],
        body,
      );
      await expect(Promise.resolve(value)).resolves.toBe("override");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(body).toHaveBeenCalledTimes(1);
    },
  );

  it("lets a genuinely asynchronous outer wrapper observe an intervening callback error", async () => {
    const original = new Error("customer failure");
    const body = jest.fn(async () => {
      await 0;
      throw original;
    });
    const value = run(
      [
        {
          async wrapOperationAttemptFn(_info, next) {
            const result = await next();
            await 0;
            return result;
          },
        },
        {
          wrapOperationAttemptFn(_info, next) {
            void (next() as Promise<unknown>).catch(() => undefined);
            return Promise.resolve("override");
          },
        },
      ],
      body,
    );
    await expect(value).rejects.toBe(original);
    expect(body).toHaveBeenCalledTimes(1);
  });

  it.each(
    [1, 3].flatMap((callbackTicks) =>
      [false, true].map((rejectOuter) => ({ callbackTicks, rejectOuter })),
    ),
  )(
    "uses the callback error observed at outer fulfillment or rejection (ticks=$callbackTicks, reject=$rejectOuter)",
    async ({ callbackTicks, rejectOuter }) => {
      const original = new Error("customer failure");
      const body = jest.fn(async () => {
        for (let i = 0; i < callbackTicks; i++) await 0;
        throw original;
      });
      const outer = jest.fn(async (_info, next: CustomerFn) => {
        const value = await next();
        await 0;
        if (rejectOuter) throw new Error("outer plugin failure");
        return value;
      });
      const inner = jest.fn((_info, next: CustomerFn) => {
        void (next() as Promise<unknown>).catch(() => undefined);
        return Promise.resolve("override");
      });
      const value = run(
        [{ wrapOperationAttemptFn: outer }, { wrapOperationAttemptFn: inner }],
        body,
      );
      if (callbackTicks === 1) await expect(value).rejects.toBe(original);
      else await expect(value).resolves.toBe("override");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(body).toHaveBeenCalledTimes(1);
      expect(inner).toHaveBeenCalledTimes(1);
      expect(outer).toHaveBeenCalledTimes(1);
    },
  );

  it.each(
    [1, 2, 3].flatMap((layers) =>
      [0, 1, 2].map((delay) => ({ layers, delay })),
    ),
  )(
    "preserves a ready callback's race against a microtask deadline (layers=$layers, delay=$delay)",
    async ({ layers, delay }) => {
      const body = jest.fn(() => {
        let result = Promise.resolve("body");
        for (let i = 0; i < delay; i++) result = result.then((value) => value);
        return result;
      });
      const wrappers = Array.from({ length: layers }, (_, index) =>
        jest.fn((_info, next: CustomerFn) =>
          index === 0
            ? Promise.race([next(), Promise.resolve().then(() => "deadline")])
            : next(),
        ),
      );
      const value = run(
        wrappers.map((wrapOperationAttemptFn) => ({ wrapOperationAttemptFn })),
        body,
      );
      await expect(value).resolves.toBe(delay === 0 ? "body" : "deadline");
      expect(body).toHaveBeenCalledTimes(1);
      for (const wrap of wrappers) expect(wrap).toHaveBeenCalledTimes(1);
    },
  );

  it.each(
    [false, true].flatMap((adopted) =>
      [false, true].map((rejectAdopted) => ({ adopted, rejectAdopted })),
    ),
  )(
    "captures errors when an adopted result actually settles (adopted=$adopted, rejects=$rejectAdopted)",
    async ({ adopted, rejectAdopted }) => {
      const original = new Error("customer failure");
      const body = jest.fn(async () => {
        await 0;
        throw original;
      });
      let reads = 0;
      const outer = jest.fn((_info, next: CustomerFn) => {
        const pending = Promise.resolve(next()).then(async () => {
          await 0;
          if (rejectAdopted) throw new Error("adopted plugin failure");
          return "outer override";
        });
        if (!adopted) return pending;
        // biome-ignore lint/suspicious/noThenProperty: Native adoption must use the captured method once and preserve its receiver.
        const thenable = Object.defineProperty({}, "then", {
          get() {
            reads++;
            return function (
              this: unknown,
              resolve: (value: unknown) => void,
              reject: (error: unknown) => void,
            ) {
              expect(this).toBe(thenable);
              resolve(pending);
              reject(new Error("ignored after resolution was selected"));
              throw new Error("also ignored after resolution was selected");
            };
          },
        });
        return thenable;
      });
      const inner = jest.fn((_info, next: CustomerFn) => {
        void (next() as Promise<unknown>).catch(() => undefined);
        return Promise.resolve("override");
      });
      const value = run(
        [{ wrapOperationAttemptFn: outer }, { wrapOperationAttemptFn: inner }],
        body,
      );
      await expect(value).rejects.toBe(original);
      expect(body).toHaveBeenCalledTimes(1);
      expect(inner).toHaveBeenCalledTimes(1);
      expect(outer).toHaveBeenCalledTimes(1);
      expect(reads).toBe(adopted ? 1 : 0);
    },
  );

  it("settles a synchronous thenable's ordinary object before a later callback error", async () => {
    const original = new Error("customer failure");
    const chosen = { answer: 42 };
    const body = jest.fn(async () => {
      await 0;
      throw original;
    });
    const value = run(
      [
        {
          wrapOperationAttemptFn(_info, next) {
            void (next() as Promise<unknown>).catch(() => undefined);
            return {
              // biome-ignore lint/suspicious/noThenProperty: An ordinary object must not acquire an adoption reaction.
              then(resolve: (value: unknown) => unknown) {
                return resolve(chosen);
              },
            };
          },
        },
      ],
      body,
    );
    await expect(Promise.resolve(value)).resolves.toBe(chosen);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(body).toHaveBeenCalledTimes(1);
  });

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
