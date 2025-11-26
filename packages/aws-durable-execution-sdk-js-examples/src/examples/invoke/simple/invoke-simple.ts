import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Invoke Simple",
  description:
    "Demonstrates a simple invoke, returning the result of the invoke",
};

export const handler = withDurableExecution(
  async (
    event: {
      functionName: string;
      payload: Record<string, any>;
    },
    context: DurableContext,
  ) => {
    const result = await context.invoke(event.functionName, event.payload);
    return result;
  },
);
