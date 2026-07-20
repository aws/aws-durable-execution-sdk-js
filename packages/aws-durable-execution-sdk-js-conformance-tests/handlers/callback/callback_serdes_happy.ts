// 4-15: Callback with custom serdes (happy path)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

interface CustomData {
  id: number;
  message: string;
  timestamp: Date;
}

const customSerdes = {
  serialize: async (
    data: CustomData | undefined,
  ): Promise<string | undefined> => {
    if (data === undefined) return undefined;
    return JSON.stringify({
      ...data,
      timestamp: data.timestamp.toISOString(),
    });
  },
  deserialize: async (
    str: string | undefined,
  ): Promise<CustomData | undefined> => {
    if (str === undefined) return undefined;
    const parsed = JSON.parse(str) as {
      id: number;
      message: string;
      timestamp: string;
    };
    return {
      ...parsed,
      timestamp: new Date(parsed.timestamp),
    };
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<CustomData>(event, {
      serdes: customSerdes,
    });
    const result = await callbackPromise;
    return {
      received: {
        id: result.id,
        message: result.message,
        timestamp: Math.floor(result.timestamp.getTime() / 1000),
      },
    };
  },
);
