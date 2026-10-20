import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "aws-lambda";
import { withDurableExecution } from "./with-durable-execution";
import type { DurableInstrumentationPlugin } from "./types/plugin";
import type { DurableExecutionInvocationInput } from "./types/core";

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
