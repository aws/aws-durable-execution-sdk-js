import type { Context } from "aws-lambda";
import type { DurableExecutionInvocationInput } from "../../types/core";

const event: DurableExecutionInvocationInput = {
  DurableExecutionArn:
    "arn:aws:lambda:us-west-2:123456789012:function:partial:1/durable-execution/test/id",
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
  awsRequestId: "partial-util",
  getRemainingTimeInMillis: () => 60000,
} as Context;
const info = {
  id: "step",
  name: "work",
  type: "STEP",
  isReplay: false,
  attempt: 1,
};

describe.each(["missing-types", "missing-isPromise"])(
  "wrapper observation with partial util: %s",
  (mode) => {
    beforeEach(() => {
      jest.resetModules();
      jest.doMock("node:util", () => ({
        __esModule: true,
        default: {
          format: (...args: unknown[]) => args.map(String).join(" "),
          ...(mode === "missing-isPromise" ? { types: {} } : {}),
        },
      }));
      jest.doMock("node:util/types", () => {
        throw new Error("unsupported util/types subpath");
      });
    });
    afterEach(() => {
      jest.dontMock("node:util");
      jest.dontMock("node:util/types");
      jest.resetModules();
    });

    it.each(
      [undefined, null, 42].flatMap((then) =>
        [false, true].map((failure) => ({ then, failure })),
      ),
    )(
      "keeps a distinct native transformed result (then=$then, failure=$failure)",
      async ({ then, failure }) => {
        const { withDurableExecution } = await import(
          "../../with-durable-execution"
        );
        const original = new Error("customer failure");
        const body = jest.fn(async () => {
          if (failure) throw original;
          return "body";
        });
        const handler = withDurableExecution(body, {
          plugins: [
            {
              wrapInvocation(_info, next) {
                const transformed = next().then((output) => ({
                  ...output,
                  reviewTransform: true,
                }));
                // biome-ignore lint/suspicious/noThenProperty: Prove the same-realm fallback without util.types, not the exact-next shortcut.
                Object.defineProperty(transformed, "then", { value: then });
                return transformed;
              },
            },
          ],
          durableExecutionClient: {
            checkpoint: async () => ({
              CheckpointToken: "token",
              NewExecutionState: { Operations: [] },
            }),
            getExecutionState: async () => ({ Operations: [] }),
          },
        });
        const output = await handler(event, context);
        expect(output).not.toBeInstanceOf(Promise);
        expect(output).toMatchObject({
          Status: failure ? "FAILED" : "SUCCEEDED",
          reviewTransform: true,
        });
        if (failure) {
          expect(output).toMatchObject({
            Error: { ErrorMessage: original.message },
          });
        } else {
          expect(output).toMatchObject({ Result: '"body"' });
        }
        expect(body).toHaveBeenCalledTimes(1);
      },
    );

    it("does not classify an ordinary object by its string tag", async () => {
      const { createPluginRunner } = await import("./plugin-runner");
      const tagged = { value: "synchronous" };
      // biome-ignore lint/suspicious/noThenProperty: Ordinary non-callable then values remain synchronous data.
      Object.defineProperty(tagged, "then", { value: undefined });
      const tag = jest.fn(() => {
        throw new Error("do not inspect this string tag");
      });
      Object.defineProperty(tagged, Symbol.toStringTag, { get: tag });
      const body = jest.fn();
      const runner = createPluginRunner([
        { wrapOperationAttemptFn: () => tagged },
      ]);
      expect(runner.wrapOperationAttemptFn!(info, body)).toBe(tagged);
      expect(body).not.toHaveBeenCalled();
      expect(tag).not.toHaveBeenCalled();
    });

    it("retains an undefined short circuit", async () => {
      const { createPluginRunner } = await import("./plugin-runner");
      const body = jest.fn();
      const runner = createPluginRunner([
        { wrapOperationAttemptFn: () => undefined },
      ]);
      expect(runner.wrapOperationAttemptFn!(info, body)).toBeUndefined();
      expect(body).not.toHaveBeenCalled();
    });

    it("retains callable custom thenables", async () => {
      const { createPluginRunner } = await import("./plugin-runner");
      const body = jest.fn();
      const result = { value: "custom" };
      const runner = createPluginRunner([
        {
          wrapOperationAttemptFn: () => ({
            // biome-ignore lint/suspicious/noThenProperty: A supported custom PromiseLike needs no util capability.
            then(resolve: (value: unknown) => void) {
              resolve(result);
            },
          }),
        },
      ]);
      await expect(runner.wrapOperationAttemptFn!(info, body)).resolves.toBe(
        result,
      );
      expect(body).not.toHaveBeenCalled();
    });
  },
);
