import {
  DurableContext,
  withRetry,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "With Retry - Invoke",
  description:
    "Demonstrates retrying context.invoke end-to-end via the withRetry helper",
};

export const handler = withDurableExecution(
  async (
    event: {
      functionName: string;
      failUntilAttempt?: number;
      maxAttempts?: number;
    },
    context: DurableContext,
  ): Promise<{ result: unknown; attempts: number }> => {
    const failUntilAttempt = event.failUntilAttempt ?? 3;
    const maxAttempts = event.maxAttempts ?? 3;
    let attempts = 0;

    const result = await withRetry<unknown>(
      context,
      "invoke-target",
      async (ctx, attempt) => {
        attempts = attempt;
        return await ctx.invoke(`invoke-${attempt}`, event.functionName, {
          attempt,
          failUntilAttempt,
        });
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
