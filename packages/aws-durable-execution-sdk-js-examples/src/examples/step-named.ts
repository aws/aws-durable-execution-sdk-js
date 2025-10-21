import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Named Step",
  description:
    "Using context.step() with a custom name for better observability",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step("process-data", async () => {
      return `processed: ${event.data || "default"}`;
    });
    return result;
  },
);
