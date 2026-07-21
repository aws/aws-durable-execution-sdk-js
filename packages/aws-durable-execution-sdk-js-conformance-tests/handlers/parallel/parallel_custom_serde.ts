// 8-15: Parallel with a custom per-branch serde (itemSerdes) round-trips results
import {
  DurableContext,
  Serdes,
  SerdesContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Symmetric custom serde: serialize wraps the value as {"wrapped": v}; deserialize unwraps it.
const wrapSerdes: Serdes<string> = {
  serialize: async (value: string | undefined, _c: SerdesContext) =>
    JSON.stringify({ wrapped: value }),
  deserialize: async (data: string | undefined, _c: SerdesContext) =>
    JSON.parse(data as string).wrapped,
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "serde",
      [async () => "x", async () => "y"],
      { maxConcurrency: 1, itemSerdes: wrapSerdes },
    );
    return results.getResults();
  },
);
