// 9-14: Map with a custom per-item serdes
import {
  DurableContext,
  withDurableExecution,
  Serdes,
  SerdesContext,
} from "@aws/durable-execution-sdk-js";

// Real, non-identity serdes: wraps the value on serialize and unwraps on deserialize,
// so iteration results round-trip through a custom encoding (not a no-op).
const wrapSerdes: Serdes<string> = {
  serialize: async (value: string | undefined, _context: SerdesContext) =>
    value === undefined ? undefined : `wrapped:${value}`,
  deserialize: async (data: string | undefined, _context: SerdesContext) =>
    data === undefined ? undefined : data.replace(/^wrapped:/, ""),
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.map(
      "serdes",
      ["x", "y"],
      async (_ctx: DurableContext, item: string) => item.toUpperCase(),
      { maxConcurrency: 1, itemSerdes: wrapSerdes },
    );
    return results.getResults();
  },
);
