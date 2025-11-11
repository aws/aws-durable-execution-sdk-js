import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Submitter Retry Success",
  description:
    "Demonstrates waitForCallback with submitter retry strategy using exponential backoff (0.5s, 1s, 2s)",
};

export const handler = withDurableExecution(
  async (event: { shouldFail?: boolean }, context: DurableContext) => {
    const shouldFail = event.shouldFail ?? false;

    const result = await context.waitForCallback<{ data: string }>(
      "retry-submitter-callback",
      async (callbackId, ctx) => {
        ctx.logger.info("Submitting callback to external system", {
          callbackId,
        });

        if (shouldFail) {
          throw new Error("Simulated submitter failure");
        }

        ctx.logger.info("Successfully submitted callback", { callbackId });
      },
      {
        // Retry strategy: up to 4 attempts with exponential backoff
        // Delays: 1s, 2s, 4s between retries
        retryStrategy: (error, attempt) => ({
          shouldRetry: attempt < 4,
          delay: { seconds: Math.pow(2, attempt - 1) },
        }),
      },
    );

    return {
      result,
      success: true,
    };
  },
);
