import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";
import { createOtelTestSetup } from "../otel-shared/otel-test-setup";

const { plugin, exporter, getSerializedSpans } = createOtelTestSetup();

export const config: ExampleConfig = {
  name: "OTel Combined",
  durableConfig: { ExecutionTimeout: 120, RetentionPeriodInDays: 7 },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    exporter.reset();

    // 1. Sequential step
    const stepResult = await context.step(
      "sequential-step",
      async () => "step-done",
    );

    // 2. Short wait
    await context.wait("short-wait", { seconds: 2 });

    // 3. Child context
    const childResult = await context.runInChildContext(
      "child-ctx",
      async (childCtx: DurableContext) => {
        const a = await childCtx.step("child-step-1", async () => "child-a");
        const b = await childCtx.step("child-step-2", async () => "child-b");
        return `${a}:${b}`;
      },
    );

    // 4. Step with retry (fails once, succeeds on attempt 2)
    let retryAttempts = 0;
    await context.step(
      "retry-step",
      async () => {
        retryAttempts++;
        if (retryAttempts < 2) {
          throw new Error(`Attempt ${retryAttempts} failed`);
        }
        return "retry-success";
      },
      {
        retryStrategy: (error: Error, attemptsMade: number) => {
          if (attemptsMade <= 2) {
            return { shouldRetry: true, delay: { seconds: 1 } };
          }
          return { shouldRetry: false };
        },
      },
    );

    // 5. Map
    const items = ["item-1", "item-2", "item-3"];
    const mapResults = await context.map(
      "map-items",
      items,
      async (ctx: DurableContext, item: string, index: number) => {
        return await ctx.step(`map-step-${index}`, async () =>
          item.toUpperCase(),
        );
      },
    );

    // 6. Parallel
    await context.parallel("parallel-ops", [
      {
        name: "branch-1",
        func: async (ctx: DurableContext) =>
          ctx.step("parallel-step-1", async () => "p1"),
      },
      {
        name: "branch-2",
        func: async (ctx: DurableContext) =>
          ctx.step("parallel-step-2", async () => "p2"),
      },
    ]);

    return {
      patterns: stepResult,
      childResult,
      retryAttempts,
      mapItemCount: mapResults.getResults().length,
      complete: true,
      spans: getSerializedSpans(),
    };
  },
  { plugins: [plugin] },
);
