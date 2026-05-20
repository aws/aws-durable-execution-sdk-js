import { DurableContext } from "../../types/durable-context";
import { Duration } from "../../types";
import { withRetry } from ".";

/**
 * Minimal `DurableContext` stub that records `wait` / `runInChildContext`
 * invocations. Only the methods used by `withRetry` are implemented.
 */
function createMockContext(): {
  context: DurableContext;
  waits: Array<{ name: string | undefined; duration: Duration }>;
  childContextCalls: Array<{ name: string | undefined; config: unknown }>;
  childContextNames: Array<string | undefined>;
} {
  const waits: Array<{ name: string | undefined; duration: Duration }> = [];
  const childContextCalls: Array<{
    name: string | undefined;
    config: unknown;
  }> = [];
  const childContextNames: Array<string | undefined> = [];

  const context = {
    wait: jest.fn(
      async (nameOrDuration: string | Duration, maybeDuration?: Duration) => {
        if (typeof nameOrDuration === "string") {
          waits.push({ name: nameOrDuration, duration: maybeDuration! });
        } else {
          waits.push({ name: undefined, duration: nameOrDuration });
        }
      },
    ),
    runInChildContext: jest.fn(
      async (
        nameOrFn: string | ((childCtx: DurableContext) => Promise<unknown>),
        fnOrConfig?: ((childCtx: DurableContext) => Promise<unknown>) | unknown,
        maybeConfig?: unknown,
      ) => {
        if (typeof nameOrFn === "string") {
          const fn = fnOrConfig as (
            childCtx: DurableContext,
          ) => Promise<unknown>;
          childContextCalls.push({ name: nameOrFn, config: maybeConfig });
          childContextNames.push(nameOrFn);
          return fn(context);
        } else {
          childContextCalls.push({ name: undefined, config: fnOrConfig });
          childContextNames.push(undefined);
          return nameOrFn(context);
        }
      },
    ),
  } as unknown as DurableContext;

  return { context, waits, childContextCalls, childContextNames };
}

describe("withRetry", () => {
  it("returns the result on the first attempt without retrying", async () => {
    const { context, waits, childContextNames } = createMockContext();
    const operation = jest.fn(async () => "success");

    const result = await withRetry(context, "op", operation, {
      retryStrategy: () => ({ shouldRetry: true, delay: { seconds: 1 } }),
    });

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledWith(context, 1);
    expect(waits).toHaveLength(0);
    expect(childContextNames).toEqual(["op"]);
  });

  it("retries until the operation succeeds", async () => {
    const { context, waits } = createMockContext();
    const operation = jest
      .fn<Promise<string>, [DurableContext, number]>()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(context, "op", operation, {
      retryStrategy: (_err, attempt) => ({
        shouldRetry: attempt < 3,
        delay: { seconds: 2 ** attempt },
      }),
    });

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([
      { name: "op-backoff-1", duration: { seconds: 2 } },
      { name: "op-backoff-2", duration: { seconds: 4 } },
    ]);
  });

  it("throws the last error when retries are exhausted", async () => {
    const { context } = createMockContext();
    const finalError = new Error("final");
    const operation = jest
      .fn<Promise<string>, [DurableContext, number]>()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(finalError);

    await expect(
      withRetry(context, "op", operation, {
        retryStrategy: (_err, attempt) => ({ shouldRetry: attempt < 2 }),
      }),
    ).rejects.toBe(finalError);

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("throws immediately when the strategy returns shouldRetry=false", async () => {
    const { context, waits } = createMockContext();
    const error = new Error("nope");
    const operation = jest
      .fn<Promise<string>, [DurableContext, number]>()
      .mockRejectedValueOnce(error);
    const retryStrategy = jest.fn(() => ({ shouldRetry: false }));

    await expect(
      withRetry(context, "op", operation, { retryStrategy }),
    ).rejects.toBe(error);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(retryStrategy).toHaveBeenCalledWith(error, 1);
    expect(waits).toHaveLength(0);
  });

  it("defaults the backoff delay to 1 second when none is provided", async () => {
    const { context, waits } = createMockContext();
    const operation = jest
      .fn<Promise<string>, [DurableContext, number]>()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");

    await withRetry(context, "op", operation, {
      retryStrategy: () => ({ shouldRetry: true }),
    });

    expect(waits).toEqual([{ name: "op-backoff-1", duration: { seconds: 1 } }]);
  });

  it("wraps the retry loop in runInChildContext by default", async () => {
    const { context, childContextNames } = createMockContext();
    const operation = jest.fn(async () => "ok");

    await withRetry(context, "my-op", operation, {
      retryStrategy: () => ({ shouldRetry: false }),
    });

    expect(childContextNames).toEqual(["my-op"]);
    expect(context.runInChildContext).toHaveBeenCalledTimes(1);
  });

  it("skips runInChildContext when wrapWithRunInChildContext is false", async () => {
    const { context, childContextNames } = createMockContext();
    const operation = jest.fn(async () => "ok");

    await withRetry(context, "my-op", operation, {
      retryStrategy: () => ({ shouldRetry: false }),
      wrapWithRunInChildContext: false,
    });

    expect(childContextNames).toEqual([]);
    expect(context.runInChildContext).not.toHaveBeenCalled();
  });

  it("passes the 1-based attempt number to the operation", async () => {
    const { context } = createMockContext();
    const attempts: number[] = [];
    const operation = jest.fn(async (_ctx: DurableContext, attempt: number) => {
      attempts.push(attempt);
      if (attempt < 3) throw new Error("retry");
      return "done";
    });

    await withRetry(context, "op", operation, {
      retryStrategy: (_err, attempt) => ({ shouldRetry: attempt < 3 }),
    });

    expect(attempts).toEqual([1, 2, 3]);
  });

  describe("anonymous (no name)", () => {
    it("wraps the loop in an anonymous runInChildContext and waits anonymously during backoff", async () => {
      const { context, waits, childContextNames } = createMockContext();
      const operation = jest
        .fn<Promise<string>, [DurableContext, number]>()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce("ok");

      const result = await withRetry(context, operation, {
        retryStrategy: (_err, attempt) => ({
          shouldRetry: attempt < 2,
          delay: { seconds: 3 },
        }),
      });

      expect(result).toBe("ok");
      expect(childContextNames).toEqual([undefined]);
      expect(context.runInChildContext).toHaveBeenCalledTimes(1);
      expect(waits).toEqual([{ name: undefined, duration: { seconds: 3 } }]);
    });

    it("skips runInChildContext when wrapWithRunInChildContext is false (anonymous overload)", async () => {
      const { context, childContextNames } = createMockContext();
      const operation = jest.fn(async () => "ok");

      await withRetry(context, operation, {
        retryStrategy: () => ({ shouldRetry: false }),
        wrapWithRunInChildContext: false,
      });

      expect(childContextNames).toEqual([]);
      expect(context.runInChildContext).not.toHaveBeenCalled();
    });
  });

  describe("childContextConfig", () => {
    it("forwards childContextConfig to runInChildContext in the named form", async () => {
      const { context, childContextCalls } = createMockContext();
      const operation = jest.fn(async () => "ok");
      const childContextConfig = { subType: "approval-flow" };

      await withRetry(context, "op", operation, {
        retryStrategy: () => ({ shouldRetry: false }),
        childContextConfig,
      });

      expect(childContextCalls).toEqual([
        { name: "op", config: childContextConfig },
      ]);
    });

    it("forwards childContextConfig to runInChildContext in the anonymous form", async () => {
      const { context, childContextCalls } = createMockContext();
      const operation = jest.fn(async () => "ok");
      const childContextConfig = { subType: "approval-flow" };

      await withRetry(context, operation, {
        retryStrategy: () => ({ shouldRetry: false }),
        childContextConfig,
      });

      expect(childContextCalls).toEqual([
        { name: undefined, config: childContextConfig },
      ]);
    });

    it("is ignored when wrapWithRunInChildContext is false", async () => {
      const { context } = createMockContext();
      const operation = jest.fn(async () => "ok");

      await withRetry(context, "op", operation, {
        retryStrategy: () => ({ shouldRetry: false }),
        wrapWithRunInChildContext: false,
        childContextConfig: { subType: "should-not-be-used" },
      });

      expect(context.runInChildContext).not.toHaveBeenCalled();
    });
  });
});
