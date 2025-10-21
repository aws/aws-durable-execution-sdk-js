import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Wait for Callback",
  description: "Basic callback waiting",
};

const mySubmitterFunction = async (callbackId: string): Promise<void> => {
  console.log(`Calling my external system with callback id: ${callbackId}`);
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    console.log("Hello world before callback!");
    const result = await context.waitForCallback(
      "my callback function",
      mySubmitterFunction,
      {
        timeout: 5,
      },
    );
    console.log("Hello world after callback!");

    return result;
  },
);
