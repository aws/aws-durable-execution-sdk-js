import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Named Wait",
  description: "Using context.wait() with a custom name",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    console.log("Starting wait operation");
    await context.wait("wait-2-seconds", 2);
    console.log("Wait completed");
    return "wait finished";
  },
);
