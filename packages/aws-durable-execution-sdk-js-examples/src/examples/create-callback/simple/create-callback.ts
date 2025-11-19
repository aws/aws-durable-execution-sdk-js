import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Create Callback",
  description: "Creating a callback ID for external systems to use",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise, callbackId] =
      await context.createCallback<string>();

    // In a real scenario, you would send the callbackId to an external system
    // For this example, we'll just store it for the test to use

    // The promise would be resolved by calling SendDurableExecutionCallbackSuccess
    // with the callbackId from an external system
    return await callbackPromise;
  },
);
