import {
  DurableContext,
  retryPresets,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map Fail-Fast History Agreement",
  description:
    "A fail-fast map reports the same finished items as the execution history, live and on replay (issue #967).",
};

export type Scenario =
  // Item 1 fails in the same turn as the others succeed.
  | "same-turn"
  // As same-turn, but deserializing an item's result takes 5 ms.
  | "slow-item-deserialize"
  // Item 1 fails 20 ms after the others succeed.
  | "failure-later";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const slowItemSerdes = {
  serialize: async (value: number | undefined): Promise<string | undefined> =>
    JSON.stringify(value),
  deserialize: async (
    data: string | undefined,
  ): Promise<number | undefined> => {
    await sleep(5);
    return data === undefined ? undefined : JSON.parse(data);
  },
};

export const handler = withDurableExecution(
  async (event: { scenario: Scenario }, context: DurableContext) => {
    const results = await context.map(
      "m",
      [0, 1, 2, 3],
      async (childContext, item) =>
        childContext.step(
          "s",
          async () => {
            if (item === 1) {
              if (event.scenario === "failure-later") {
                await sleep(20);
              }
              throw new Error("boom");
            }
            return item * 10;
          },
          { retryStrategy: retryPresets.noRetry },
        ),
      event.scenario === "slow-item-deserialize"
        ? { itemSerdes: slowItemSerdes }
        : undefined,
    );

    const live = await context.step("capture-live", async () => ({
      statuses: results.all.map((item) => item.status),
      results: results.getResults(),
    }));

    // Ends the invocation, so the map result below comes from replay.
    await context.wait("force-replay", { seconds: 1 });

    return {
      live,
      replay: {
        statuses: results.all.map((item) => item.status),
        results: results.getResults(),
      },
    };
  },
);
