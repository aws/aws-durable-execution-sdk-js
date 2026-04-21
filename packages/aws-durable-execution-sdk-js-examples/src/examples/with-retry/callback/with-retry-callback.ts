import {
  DurableContext,
  withRetry,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "With Retry - Callback",
  description:
    "Demonstrates retrying waitForCallback end-to-end (new callbackId per attempt) via the withRetry helper",
};

export const handler = withDurableExecution(
  async (
    event: { maxAttempts?: number },
    context: DurableContext,
  ): Promise<{ result: string; attempts: number }> => {
    const maxAttempts = event.maxAttempts ?? 3;
    let attempts = 0;

    const result = await withRetry<string>(
      context,
      "approval",
      async (ctx, attempt) => {
        attempts = attempt;
        return await ctx.waitForCallback<string>(
          `approval-${attempt}`,
          async () => {
            // External system would be notified with the callbackId here
          },
          { timeout: { seconds: 30 } },
        );
      },
      {
        retryStrategy: (_error, attempt) => ({
          shouldRetry: attempt < maxAttempts,
          delay: { seconds: 1 },
        }),
      },
    );

    return { result, attempts };
  },
);
