import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "aws-lambda";
import { withDurableExecution } from "./with-durable-execution";
import type { DurableInstrumentationPlugin } from "./types/plugin";
import type {
  DurableExecutionInvocationInput,
  DurableExecutionInvocationOutput,
} from "./types/core";

const faults = ["hook-getter", "result-proxy", "next-then-getter"] as const;
type Fault = (typeof faults)[number];

function brokenWrapper(fault: Fault): DurableInstrumentationPlugin {
  const fail = () => {
    throw new Error(`instrumentation ${fault}`);
  };
  if (fault === "hook-getter") {
    return Object.defineProperty({}, "wrapInvocation", { get: fail });
  }
  return {
    wrapInvocation(_info, next) {
      const result = next();
      if (fault === "next-then-getter") {
        // biome-ignore lint/suspicious/noThenProperty: An instrumentation wrapper can replace this promise accessor.
        Object.defineProperty(result, "then", { get: fail });
        return result;
      }
      return new Proxy(result, {
        get(target, key, receiver) {
          if (key === "then") return fail();
          return Reflect.get(target, key, receiver);
        },
      });
    },
  };
}

const event: DurableExecutionInvocationInput = {
  DurableExecutionArn:
    "arn:aws:lambda:us-west-2:123456789012:function:wrapper:1/durable-execution/test/id",
  CheckpointToken: "token",
  InitialExecutionState: {
    Operations: [
      {
        Id: "execution",
        Type: "EXECUTION",
        Status: "STARTED",
        StartTimestamp: new Date("2026-01-01T00:00:00Z"),
        ExecutionDetails: { InputPayload: "{}" },
      },
    ],
  },
};

const context = {
  awsRequestId: "wrapper-request",
  getRemainingTimeInMillis: () => 60000,
} as Context;

describe.each(faults)("public wrapper isolation: %s", (fault) => {
  it.each([false, true])(
    "preserves healthy wrappers, active context and the handler outcome (failure=%s)",
    async (failure) => {
      const scope = new AsyncLocalStorage<string>();
      const order: string[] = [];
      const bodyError = new Error("customer failure");
      const starts = jest.fn();
      const ends = jest.fn();
      const healthy = (name: string): DurableInstrumentationPlugin => ({
        onInvocationStart: starts,
        onInvocationEnd: ends,
        wrapInvocation: (_info, next) =>
          scope.run(name, async () => {
            order.push(`${scope.getStore()}:before`);
            const result = await next();
            order.push(`${scope.getStore()}:after`);
            return result;
          }),
      });
      const body = jest.fn(async () => {
        order.push(`${scope.getStore()}:body`);
        if (failure) throw bodyError;
        return { result: "customer result" };
      });
      const handler = withDurableExecution(body, {
        plugins: [healthy("outer"), brokenWrapper(fault), healthy("inner")],
        durableExecutionClient: {
          checkpoint: async () => ({
            CheckpointToken: "token",
            NewExecutionState: { Operations: [] },
          }),
          getExecutionState: async () => ({ Operations: [] }),
        },
      });
      await scope.run("caller", async () => {
        const output = await handler(event, context);
        expect(scope.getStore()).toBe("caller");
        if (failure) {
          expect(output).toMatchObject({
            Status: "FAILED",
            Error: { ErrorMessage: bodyError.message },
          });
          expect(ends.mock.calls[0][0].executionError).toBe(bodyError);
        } else {
          expect(output).toEqual({
            Status: "SUCCEEDED",
            Result: JSON.stringify({ result: "customer result" }),
          });
        }
      });
      expect(scope.getStore()).toBeUndefined();
      expect(body).toHaveBeenCalledTimes(1);
      expect(starts).toHaveBeenCalledTimes(2);
      expect(ends).toHaveBeenCalledTimes(2);
      expect(order).toEqual([
        "outer:before",
        "inner:before",
        "inner:body",
        "inner:after",
        "outer:after",
      ]);
    },
  );
});

describe.each(
  [undefined, null, 42].flatMap((then) =>
    [false, true].map((transformed) => ({ then, transformed })),
  ),
)(
  "returned native promise with then=$then (transformed=$transformed)",
  ({ then, transformed }) => {
    it.each([false, true])(
      "returns the invocation output, not the promise object (failure=%s)",
      async (failure) => {
        const scope = new AsyncLocalStorage<string>();
        const bodyError = new Error("customer failure");
        const end = jest.fn();
        const wrap = jest.fn(
          (_info, next: () => Promise<DurableExecutionInvocationOutput>) =>
            scope.run("healthy", async () => {
              const output = await next();
              expect(scope.getStore()).toBe("healthy");
              return output;
            }),
        );
        const body = jest.fn(async () => {
          expect(scope.getStore()).toBe("healthy");
          if (failure) throw bodyError;
          return "customer result";
        });
        const handler = withDurableExecution(body, {
          plugins: [
            {
              wrapInvocation(_info, next) {
                const original = next();
                const promise = transformed
                  ? original.then((output) => ({
                      ...output,
                      reviewTransform: true,
                    }))
                  : original;
                // biome-ignore lint/suspicious/noThenProperty: A native promise remains awaitable when this property is non-callable.
                Object.defineProperty(promise, "then", { value: then });
                return promise;
              },
            },
            { wrapInvocation: wrap, onInvocationEnd: end },
          ],
          durableExecutionClient: {
            checkpoint: async () => ({
              CheckpointToken: "token",
              NewExecutionState: { Operations: [] },
            }),
            getExecutionState: async () => ({ Operations: [] }),
          },
        });
        await scope.run("caller", async () => {
          const output = await handler(event, context);
          expect(scope.getStore()).toBe("caller");
          expect(output).not.toBeInstanceOf(Promise);
          if (failure) {
            expect(output).toMatchObject({
              Status: "FAILED",
              Error: { ErrorMessage: bodyError.message },
              ...(transformed ? { reviewTransform: true } : {}),
            });
            expect(end.mock.calls[0][0].executionError).toBe(bodyError);
          } else {
            expect(output).toEqual({
              Status: "SUCCEEDED",
              Result: '"customer result"',
              ...(transformed ? { reviewTransform: true } : {}),
            });
          }
        });
        expect(scope.getStore()).toBeUndefined();
        expect(body).toHaveBeenCalledTimes(1);
        expect(wrap).toHaveBeenCalledTimes(1);
        expect(end).toHaveBeenCalledTimes(1);
      },
    );
  },
);

it.each(
  [0, 1, 2].flatMap((ticks) =>
    [false, true].map((outerAwait) => ({ ticks, outerAwait })),
  ),
)(
  "preserves public step override precedence across adjacent microtasks (callbackTicks=$ticks, outerAwait=$outerAwait)",
  async ({ ticks, outerAwait }) => {
    const original = new Error("step customer failure");
    const body = jest.fn(async () => {
      for (let i = 0; i < ticks; i++) await 0;
      throw original;
    });
    const attemptEnd = jest.fn();
    const handler = withDurableExecution(
      async (_event, context) =>
        context.step("work", body, {
          retryStrategy: () => ({ shouldRetry: false }),
        }),
      {
        plugins: [
          ...(outerAwait
            ? [
                {
                  async wrapOperationAttemptFn(
                    _info: unknown,
                    next: () => unknown,
                  ) {
                    return await next();
                  },
                },
              ]
            : []),
          {
            wrapOperationAttemptFn(_info, next) {
              void (next() as Promise<unknown>).catch(() => undefined);
              return Promise.resolve("override");
            },
            onOperationAttemptEnd: attemptEnd,
          },
        ],
        durableExecutionClient: {
          checkpoint: async () => ({
            CheckpointToken: "token",
            NewExecutionState: { Operations: [] },
          }),
          getExecutionState: async () => ({ Operations: [] }),
        },
      },
    );
    const output = await handler(event, context);
    if (ticks === 0 || (outerAwait && ticks === 1)) {
      expect(output).toMatchObject({
        Status: "FAILED",
        Error: { ErrorMessage: original.message },
      });
    } else {
      expect(output).toEqual({
        Status: "SUCCEEDED",
        Result: JSON.stringify("override"),
      });
    }
    expect(body).toHaveBeenCalledTimes(1);
    expect(attemptEnd).toHaveBeenCalledTimes(1);
  },
);
