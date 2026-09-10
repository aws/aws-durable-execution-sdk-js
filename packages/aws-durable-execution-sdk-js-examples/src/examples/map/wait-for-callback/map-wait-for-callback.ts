import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map with waitForCallback",
  description:
    "Reproducer for issue #510: map branches using waitForCallback should progress " +
    "immediately after all callbacks signal, without needing an unrelated timer to resume.",
};

// Matches the bug report: 2 items, maxConcurrency: 4
const ITEMS = [0, 1];

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const results = await context.map(
      "map-step",
      ITEMS,
      async (branchCtx: DurableContext, idx: number) => {
        return await branchCtx.waitForCallback(
          `wait-${idx}`,
          async (_callbackId: string) => {
            // In production this would write callbackId to S3 and invoke a worker Lambda.
            // In this local reproducer the test drives the callback directly.
          },
          { timeout: { minutes: 30 } },
        );
      },
      { maxConcurrency: 4 },
    );

    results.throwIfError();

    // This step must execute immediately after all callbacks complete —
    // not only after an unrelated timer fires (the bug).
    const processed = await context.step("after-map", async () => {
      return (results.getResults() as string[]).map((r) => `processed:${r}`);
    });

    return processed;
  },
);
