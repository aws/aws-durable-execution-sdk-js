import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map Wait for Callback",
  description:
    "Demonstrates context.map where each branch uses waitForCallback - reproduces issue #510",
};

export const handler = withDurableExecution(
  async (event: { items?: number[] }, context: DurableContext) => {
    const items = event.items ?? [0, 1];

    const results = await context.map(
      "map-callbacks",
      items,
      async (branchCtx, item) => {
        return await branchCtx.waitForCallback<string>(
          "branch-callback",
          async () => {
            // Submitter: in production this would trigger external async work
            // (e.g. write callbackId to S3, invoke another Lambda)
            return Promise.resolve();
          },
        );
      },
      { maxConcurrency: 4 },
    );

    // This step must execute promptly after all callbacks signal.
    // Issue #510: in cloud, this wedges ~11-12 min after last callback.
    const afterMap = await context.step("after-map", async () => {
      return `processed ${items.length} items`;
    });

    return {
      callbackResults: results.getResults(),
      afterMap,
    };
  },
);
