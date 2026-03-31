import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

/**
 * Verifies that context.parallel() with context.invoke() branches correctly
 * suspends between individual branch completions rather than staying active
 * and polling for remaining branches.
 */

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("Parallel invoke inter-branch suspension", () => {
  it("should suspend between parallel invoke branch completions", async () => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const results = await context.parallel("parallel-invokes", [
          {
            name: "branch-a",
            func: async (ctx: DurableContext) => {
              return await ctx.invoke("invoke-a", "function-a-arn", {
                input: "a",
              });
            },
          },
          {
            name: "branch-b",
            func: async (ctx: DurableContext) => {
              return await ctx.invoke("invoke-b", "function-b-arn", {
                input: "b",
              });
            },
          },
        ]);

        return { count: results.successCount };
      },
    );

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    runner.registerDurableFunction(
      "function-a-arn",
      withDurableExecution(async (_event: unknown, ctx) => {
        return await ctx.step("work", () => Promise.resolve({ result: "a" }));
      }),
    );

    runner.registerDurableFunction(
      "function-b-arn",
      withDurableExecution(async (_event: unknown, ctx) => {
        return await ctx.step("work", () => Promise.resolve({ result: "b" }));
      }),
    );

    const execution = await runner.run();

    expect(execution.getResult()).toEqual({ count: 2 });

    // With proper suspension we expect at least 2 invocations:
    // one to dispatch invokes and suspend, one (or more) to complete.
    const invocations = execution.getInvocations();
    expect(invocations.length).toBeGreaterThanOrEqual(2);
  });

  it("should suspend between parallel invoke branch completions with 4 branches", async () => {
    const branches = ["a", "b", "c", "d"];

    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const results = await context.parallel(
          "parallel-invokes",
          branches.map((name) => ({
            name: `branch-${name}`,
            func: async (ctx: DurableContext) => {
              return await ctx.invoke(
                `invoke-${name}`,
                `function-${name}-arn`,
                { input: name },
              );
            },
          })),
        );

        return { count: results.successCount };
      },
    );

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    for (const name of branches) {
      runner.registerDurableFunction(
        `function-${name}-arn`,
        withDurableExecution(async (_event: unknown, ctx) => {
          return await ctx.step("work", () =>
            Promise.resolve({ result: name }),
          );
        }),
      );
    }

    const execution = await runner.run();

    expect(execution.getResult()).toEqual({ count: 4 });

    const invocations = execution.getInvocations();
    expect(invocations.length).toBeGreaterThanOrEqual(2);
  });
});
