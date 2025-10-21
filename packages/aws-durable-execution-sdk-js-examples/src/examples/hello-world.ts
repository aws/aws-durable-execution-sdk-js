import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Hello World",
  description: "A simple hello world example with no durable operations",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    console.log("Hello world from a durable function!");
    return "Hello World!";
  },
);
