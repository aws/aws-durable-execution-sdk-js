import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Submitter Failure Catchable",
  description:
    "Demonstrates that submitter failures can be caught with try-catch after retries are exhausted",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    try {
      const result = await context.waitForCallback(
        "failing-submitter-callback",
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Submitter fails
          throw new Error("Submitter failed");
        },
        {
          retryStrategy: (_, attemptCount) => ({
            shouldRetry: attemptCount < 3,
            delay: { seconds: 1 },
          }),
        },
      );

      return {
        callbackResult: result,
        success: true,
      };
    } catch (error) {
      // Submitter error is caught here after retries are exhausted
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);
