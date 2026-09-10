import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map waitForCallback in parallel without watchdog",
  description:
    "Same as map-wait-for-callback-parallel but WITHOUT the watchdog branch. " +
    "Per issue #510, this configuration should wedge indefinitely.",
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
                  async (_callbackId: string) => {},
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
      ],
      { completionConfig: { minSuccessful: 1, toleratedFailureCount: 0 } },
    );

    outer.throwIfError();
    return outer.getResults();
  },
);
