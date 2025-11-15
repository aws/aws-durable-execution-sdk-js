import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait Until Timestamp",
  description:
    "Usage of context.wait() with endTimestamp to wait until a specific time",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    console.log("Starting execution at:", new Date().toISOString());

    // Wait until 5 seconds from now
    const futureTime = new Date(Date.now() + 5000).toISOString();
    await context.wait("scheduled-wait", { endTimestamp: futureTime });

    console.log("Execution resumed at:", new Date().toISOString());
    return "Function Completed";
  },
);
