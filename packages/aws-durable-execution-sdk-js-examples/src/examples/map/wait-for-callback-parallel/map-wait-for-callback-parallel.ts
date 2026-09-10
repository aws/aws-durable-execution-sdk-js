import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map waitForCallback in parallel with watchdog",
  description:
    "Reproducer matching the exact shape from issue #510: outer parallel with " +
    "a body branch containing map+waitForCallback, and a watchdog branch with ctx.wait. " +
    "Without the fix, execution wedges until the watchdog fires.",
  durableConfig: {
    ExecutionTimeout: 120,
    RetentionPeriodInDays: 7,
  },
};

const ITEMS = [0, 1];

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const outer = await context.parallel(
      "outer",
      [
        {
          name: "body",
          func: async (ctx: DurableContext) => {
            const result = await ctx.map(
              "map-step",
              ITEMS,
              async (branchCtx: DurableContext, idx: number) => {
                return await branchCtx.waitForCallback(
                  `wait-${idx}`,
                  async (_callbackId: string) => {
                    // Fire-and-forget submitter (test drives callbacks directly).
                  },
                  { timeout: { minutes: 30 } },
                );
              },
              { maxConcurrency: 4 },
            );
            result.throwIfError();
            return await ctx.step("after-map", async () => {
              return (result.getResults() as string[]).map(
                (r) => `processed:${r}`,
              );
            });
          },
        },
        {
          name: "watchdog",
          func: async (ctx: DurableContext) => {
            // Large enough watchdog to be robust against cloud network latency
            // while still short enough to keep tests fast.
            // In the bug report this is 15 minutes.
            await ctx.wait("t-watchdog", { seconds: 30 });
            return "watchdog-done";
          },
        },
      ],
      { completionConfig: { minSuccessful: 1, toleratedFailureCount: 0 } },
    );

    outer.throwIfError();
    return outer.getResults();
  },
);
