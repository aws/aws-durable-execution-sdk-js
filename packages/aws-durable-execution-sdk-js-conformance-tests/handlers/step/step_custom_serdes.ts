// 1-6: Custom serdes (per-step)
import {
  DurableContext,
  withDurableExecution,
  Serdes,
  SerdesContext,
} from "@aws/durable-execution-sdk-js";

const uppercaseSerdes: Serdes<string> = {
  serialize: async (value: string | undefined, _context: SerdesContext) => {
    if (value === undefined) return undefined;
    return value.toUpperCase();
  },
  deserialize: async (data: string | undefined, _context: SerdesContext) => {
    return data;
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(
      async () => {
        return event as string;
      },
      { serdes: uppercaseSerdes },
    );
    return result;
  },
);
