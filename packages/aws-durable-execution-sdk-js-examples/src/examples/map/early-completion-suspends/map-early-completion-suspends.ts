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

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    // Items 1 to 3 finish their steps only after the map has returned. So
    // their result checkpoints arrive after the map's context has finished,
    // and the SDK drops them, independent of checkpoint latency. The gate is
    // created inside the handler, so a warm Lambda container does not reuse
    // it across invocations.
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    // Item 0 succeeds at once and completes the map.
    const results = await context.map(
      "m",
      [0, 1, 2, 3],
      async (childContext, item) =>
        childContext.step("s", async () => {
          if (item !== 0) {
            await gate;
          }
          return item * 10;
        }),
      { completionConfig: { minSuccessful: 1 } },
    );
    openGate();

    // This wait must suspend the invocation.
    await context.wait("after-map", { seconds: 1 });

    return results.getResults();
  },
);
