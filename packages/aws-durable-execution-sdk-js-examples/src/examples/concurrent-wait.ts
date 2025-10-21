import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Concurrent Wait",
  description: "Start multiple wait operations with Promise.all",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    console.log("Before waits");
    await Promise.all([
      context.wait("wait-1-second", 1),
      context.wait("wait-2-seconds", 2),
    ]);
    console.log("After waits");
    return "Completed waits";
  },
);
