import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map with waitForCallback higher concurrency",
  description:
    "Reproducer for issue #510 variant: 6 branches with maxConcurrency 4, " +
    "testing whether partial saturation + staggered completion causes the hang.",
};

const ITEMS = [0, 1, 2, 3];

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const results = await context.map(
      "map-step",
      ITEMS,
      async (branchCtx: DurableContext, idx: number) => {
        return await branchCtx.waitForCallback(
          `wait-${idx}`,
          async (_callbackId: string) => {
            // No-op submitter; test drives callbacks directly.
          },
          { timeout: { minutes: 30 } },
        );
      },
      { maxConcurrency: 4 },
    );

    results.throwIfError();

    const processed = await context.step("after-map", async () => {
      return (results.getResults() as string[]).map((r) => `processed:${r}`);
    });

    return processed;
  },
);
