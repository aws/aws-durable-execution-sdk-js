import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Heartbeat Sends",
  description:
    "Demonstrates sending heartbeats during long-running callback processing",
};

export const handler = withDurableExecution(
  async (
    event: {
      isCloud: boolean;
    },
    context: DurableContext,
  ) => {
    const result = await context.waitForCallback<{ processed: number }>(
      async () => {
        // Simulate long-running submitter function
        await new Promise((resolve) =>
          setTimeout(resolve, event.isCloud ? 5000 : 100),
        );
        return Promise.resolve();
      },
      {
        heartbeatTimeout: event.isCloud ? { seconds: 15 } : { seconds: 1 },
      },
    );

    return {
      callbackResult: result,
      completed: true,
    };
  },
);
