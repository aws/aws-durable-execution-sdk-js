import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Retry Exhaustion",
  description:
    "Demonstrates retry mechanism until complete exhaustion and final failure",
};

export const handler = withDurableExecution(
  async (_, context: DurableContext) => {
    await context.step(
      "retries",
      () => Promise.reject(new Error("There was an error")),
      {
        retryStrategy: (_, attemptsMade: number) => {
          const shouldRetry = attemptsMade <= 5;
          return { shouldRetry, delaySeconds: 1 + attemptsMade };
        },
      },
    );
    return { success: true, step: "completed" };
  },
);
