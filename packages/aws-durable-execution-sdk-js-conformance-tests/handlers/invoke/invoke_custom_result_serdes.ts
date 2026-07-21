// 5-16: Invoke with custom result serdes
import {
  DurableContext,
  withDurableExecution,
  Serdes,
  SerdesContext,
} from "@aws/durable-execution-sdk-js";

const uppercaseResultSerdes: Serdes<string> = {
  serialize: async (value: string | undefined, _context: SerdesContext) => {
    return value;
  },
  deserialize: async (data: string | undefined, _context: SerdesContext) => {
    if (data === undefined) return undefined;
    return data.toUpperCase();
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunctionName: string = process.env.TARGET_FUNCTION_NAME!;
    const result = await context.invoke(undefined, targetFunctionName, event, {
      resultSerdes: uppercaseResultSerdes,
    });
    return result;
  },
);
