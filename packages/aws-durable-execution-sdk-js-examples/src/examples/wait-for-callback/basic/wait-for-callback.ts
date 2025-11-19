import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback",
  description: "Basic callback waiting",
};

const mySubmitterFunction = async (callbackId: string): Promise<void> => {
  // In a real scenario, you would send the callbackId to an external system
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    console.log("Hello world before callback!");
    const result = await context.waitForCallback(
      "my callback function",
      mySubmitterFunction,
      {
        timeout: { seconds: 5 },
      },
    );
    console.log("Hello world after callback!");

    return result;
  },
);
