import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Create Callback - Timeout",
  description:
    "Demonstrates callback timeout scenarios (heartbeat timeout and general timeout)",
};

export const handler = withDurableExecution(
  async (
    event: {
      timeoutType?: "heartbeat" | "general";
    },
    context: DurableContext,
  ) => {
    const [callbackPromise] = await context.createCallback(
      "long-running-task",
      event.timeoutType === "heartbeat"
        ? { heartbeatTimeout: { seconds: 1 } }
        : { timeout: { seconds: 1 } },
    );

    const result = await callbackPromise;
    return { longTaskResult: result };
  },
);
