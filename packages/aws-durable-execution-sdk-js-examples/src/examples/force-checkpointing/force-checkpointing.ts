import {
  withDurableExecution,
  DurableContext,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event, ctx: DurableContext): Promise<string> => {
    const results = await ctx.parallel([
      // Branch 1: Long-running operation that blocks termination
      async (branchCtx: DurableContext) => {
        return await branchCtx.step("long-running-step", async () => {
          await new Promise((resolve) => setTimeout(resolve, 10000));
          return "long-complete";
        });
      },
      // Branch 2: Retrying operation that needs force checkpoint to get updates
      async (branchCtx: DurableContext) => {
        let attemptCount = 0;
        return await branchCtx.step(
          "retrying-step",
          async () => {
            attemptCount++;
            if (attemptCount < 3) {
              throw new Error(`Attempt ${attemptCount} failed`);
            }
            return "retry-complete";
          },
          {
            retryStrategy: (_error: Error, attempt: number) => {
              if (attempt >= 5) {
                return { shouldRetry: false };
              }
              return { shouldRetry: true, delay: { seconds: 1 } };
            },
          },
        );
      },
    ]);

    return JSON.stringify(results);
  },
);
