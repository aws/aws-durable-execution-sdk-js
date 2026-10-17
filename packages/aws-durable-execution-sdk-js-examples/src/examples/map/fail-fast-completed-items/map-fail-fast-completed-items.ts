import {
  DurableContext,
  retryPresets,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map Fail-Fast Completed Items",
  description:
    "A fail-fast map must keep items that already finished, including across replay (issue #967).",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const results = await context.map(
      "m",
      [0, 1, 2, 3],
      async (childContext, item) => {
        return await childContext.step(
          "s",
          async () => {
            if (item === 1) {
              throw new Error("boom");
            }
            return item * 10;
          },
          { retryStrategy: retryPresets.noRetry },
        );
      },
    );

    const live = {
      statuses: results.all.map((item) => item.status),
      successCount: results.successCount,
      startedCount: results.startedCount,
      results: results.getResults(),
    };

    const captured = await context.step("capture-live", async () => live);

    await context.wait("force-replay", { seconds: 1 });

    return {
      live: captured,
      replay: {
        statuses: results.all.map((item) => item.status),
        successCount: results.successCount,
        startedCount: results.startedCount,
        results: results.getResults(),
      },
    };
  },
);
