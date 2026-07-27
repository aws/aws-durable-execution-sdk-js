// 10-16: DAG task retries and eventually succeeds; the retried result flows
// downstream to a dependent task (ALL_COMPLETED).
import {
  DurableContext,
  withDurableExecution,
  createRetryStrategy,
  JitterStrategy,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "retrydag",
      (d) => {
        // `flaky` throws on attempts 1 and 2 and succeeds on attempt 3,
        // returning the attempt number. The per-task retryStrategy allows at
        // least 3 attempts with no meaningful backoff. This is the ordinary
        // step retry; the DAG adds nothing to it.
        const flaky = d.step(
          "flaky",
          [],
          async (stepContext): Promise<number> => {
            // Native per-step attempt counter (1-based, increments on retry).
            if (stepContext.attempt < 3) {
              throw new Error(
                `attempt ${stepContext.attempt} is not yet third`,
              );
            }
            return stepContext.attempt;
          },
          {
            retryStrategy: createRetryStrategy({
              maxAttempts: 5,
              initialDelay: { seconds: 0 },
              backoffRate: 1,
              jitter: JitterStrategy.NONE,
            }),
          },
        );
        // `after` doubles flaky's result, proving a retried task's result flows
        // downstream normally rather than the dependent being skipped.
        d.step(
          "after",
          [flaky],
          async (deps): Promise<number> => (deps.flaky as number) * 2,
        );
      },
      { maxConcurrency: 1 },
    );

    return {
      flaky: result.getResult("flaky"),
      after: result.getResult("after"),
    };
  },
);
