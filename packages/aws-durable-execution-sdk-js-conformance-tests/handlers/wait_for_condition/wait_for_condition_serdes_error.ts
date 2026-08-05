import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { AnySerdes } from "@aws/durable-execution-sdk-js";

// A custom serdes that fails on deserialize
const failingSerdes: AnySerdes = {
  serialize: async (value: any) => {
    return JSON.stringify(value);
  },
  deserialize: async (_payload: string | undefined) => {
    throw new Error("simulated deserialization failure");
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.waitForCondition(
      async (state: number) => {
        return state + 1;
      },
      {
        waitStrategy: (state: number, attempt: number) => {
          return { shouldContinue: state < 2, delay: { seconds: 1 } };
        },
        initialState: 0,
        serdes: failingSerdes,
      },
    );
    return result;
  },
);
