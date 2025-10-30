import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "No Replay Execution",
  description: "Demonstrates step execution tracking when no replay occurs",
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    await context.step("fetch-user-1", () => Promise.resolve("user-1"));
    await context.step("fetch-user-2", () => Promise.resolve("user-2"));

    return { completed: true };
  },
);
