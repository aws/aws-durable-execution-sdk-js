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

const failFastMap = async (context: DurableContext, name: string) => {
  return context.map(name, [0, 1, 2, 3], async (childContext, item) => {
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
  });
};

export const handler = withDurableExecution(
  async (
    event: { concurrentMaps?: boolean } | undefined,
    context: DurableContext,
  ) => {
    if (event?.concurrentMaps) {
      const [left, right] = await Promise.all([
        failFastMap(context, "m-a"),
        failFastMap(context, "m-b"),
      ]);
      return {
        left: {
          statuses: left.all.map((item) => item.status),
          successCount: left.successCount,
          results: left.getResults(),
        },
        right: {
          statuses: right.all.map((item) => item.status),
          successCount: right.successCount,
          results: right.getResults(),
        },
      };
    }

    const results = await failFastMap(context, "m");

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
