// 4-16: Callback with custom serdes (numeric)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

const numericSerdes = {
  serialize: async (n: number | undefined): Promise<string | undefined> =>
    n === undefined ? undefined : JSON.stringify(n),
  deserialize: async (s: string | undefined): Promise<number | undefined> =>
    s === undefined ? undefined : (JSON.parse(s) as number),
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<number>(event, {
      serdes: numericSerdes,
    });
    const value = await callbackPromise;
    return { count: value, doubled: value * 2 };
  },
);
