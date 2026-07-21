// 5-15: Invoke with custom payload serdes
import {
  DurableContext,
  withDurableExecution,
  Serdes,
  SerdesContext,
} from "@aws/durable-execution-sdk-js";

const uppercasePayloadSerdes: Serdes<any> = {
  serialize: async (value: any, _context: SerdesContext) => {
    if (value === undefined) return undefined;
    return JSON.stringify(value).toUpperCase();
  },
  deserialize: async (data: string | undefined, _context: SerdesContext) => {
    return data ? JSON.parse(data) : data;
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunctionName = process.env.TARGET_FUNCTION_NAME!;
    const result = await context.invoke(targetFunctionName, event, {
      payloadSerdes: uppercasePayloadSerdes,
    });
    return result;
  },
);
