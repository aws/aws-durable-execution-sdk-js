import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map Early Completion Suspends",
  description:
    "After a map completes early, a wait in the handler still suspends while abandoned items are still running.",
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    // Item 0 succeeds at once and completes the map. Items 1 to 3 are still
    // in their steps. Their result checkpoints are dropped, because the map
    // has completed.
    const results = await context.map(
      "m",
      [0, 1, 2, 3],
      async (childContext, item) =>
        childContext.step("s", async () => {
          if (item !== 0) {
            await sleep(200);
          }
          return item * 10;
        }),
      { completionConfig: { minSuccessful: 1 } },
    );

    // This wait must suspend the invocation.
    await context.wait("after-map", { seconds: 1 });

    return results.getResults();
  },
);
