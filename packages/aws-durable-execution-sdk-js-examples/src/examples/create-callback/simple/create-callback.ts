import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Create Callback",
  description: "Creating a callback ID for external systems to use",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise, callbackId] =
      await context.createCallback<string>();

    // In a real scenario, you would send the callbackId to an external system
    // For this example, we'll just log it
    log("Send this callbackId to external system:", callbackId);

    // The promise would be resolved by calling SendDurableExecutionCallbackSuccess
    // with the callbackId from an external system
    return await callbackPromise;
  },
);
