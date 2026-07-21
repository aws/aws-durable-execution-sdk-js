// 6-11: Wait-for-condition with custom state serdes
import {
  DurableContext,
  withDurableExecution,
  Serdes,
  SerdesContext,
} from "@aws/durable-execution-sdk-js";

const customStringSerdes: Serdes<string> = {
  serialize: async (
    value: string | undefined,
    _context: SerdesContext,
  ): Promise<string | undefined> => {
    if (value === undefined) return undefined;
    // Custom encoding: prefix with "ENC:" to prove custom serdes is used
    return "ENC:" + value;
  },
  deserialize: async (
    data: string | undefined,
    _context: SerdesContext,
  ): Promise<string | undefined> => {
    if (data === undefined) return undefined;
    // Custom decoding: strip the "ENC:" prefix
    return data.startsWith("ENC:") ? data.slice(4) : data;
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.waitForCondition(
      async (state: string) => {
        return state + "x";
      },
      {
        waitStrategy: (state: string, _attempt: number) => {
          if (state.length >= 2) {
            return { shouldContinue: false };
          }
          return { shouldContinue: true, delay: { seconds: 1 } };
        },
        initialState: "",
        serdes: customStringSerdes,
      },
    );
    return result;
  },
);
