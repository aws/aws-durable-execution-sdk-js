import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Create Callback - Heartbeat",
  description:
    "Demonstrates callback heartbeat operations during long-running tasks",
};

export const handler = withDurableExecution(
  async (
    event: {
      isCloud: boolean;
    },
    context: DurableContext,
  ) => {
    const [callbackPromise] = await context.createCallback(
      "long-running-task",
      {
        heartbeatTimeout: event.isCloud ? { seconds: 30 } : { seconds: 1 },
      },
    );

    const result = await callbackPromise;
    return { longTaskResult: result };
  },
);
