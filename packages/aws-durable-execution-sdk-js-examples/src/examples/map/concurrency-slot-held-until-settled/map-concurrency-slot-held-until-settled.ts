import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map Concurrency Slot Held Until Settled",
  description:
    "With maxConcurrency 1, the next item starts only after the previous item finished deserializing its result.",
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    // In-memory counters. The handler runs in one invocation, because it
    // creates no wait.
    let running = 0;
    let maxRunning = 0;
    const enter = (): void => {
      running++;
      maxRunning = Math.max(maxRunning, running);
    };

    const results = await context.map(
      "m",
      [0, 1, 2],
      async (childContext, item) => {
        // An item runs from the start of its function until its result is
        // deserialized.
        enter();
        return childContext.step("s", async () => item * 10);
      },
      {
        maxConcurrency: 1,
        itemSerdes: {
          serialize: async (
            value: number | undefined,
          ): Promise<string | undefined> => JSON.stringify(value),
          deserialize: async (
            data: string | undefined,
          ): Promise<number | undefined> => {
            await sleep(20);
            running--;
            return data === undefined ? undefined : JSON.parse(data);
          },
        },
      },
    );

    return { results: results.getResults(), maxRunning };
  },
);
