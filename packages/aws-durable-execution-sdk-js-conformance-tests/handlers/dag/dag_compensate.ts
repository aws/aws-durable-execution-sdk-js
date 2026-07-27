// 10-18: DAG compensation dependency read on a FAILED upstream is ABSENT, not
// present (the deps-nullability contract).
import {
  DurableContext,
  withDurableExecution,
  createRetryStrategy,
  JitterStrategy,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "compensate",
      (d) => {
        // charge always fails. Retries are disabled (maxAttempts: 1) so it ends
        // FAILED deterministically after a single attempt (exactly one
        // StepFailed).
        const charge = d.step(
          "charge",
          [],
          async (): Promise<string> => {
            throw new Error("charge failed");
          },
          {
            retryStrategy: createRetryStrategy({
              maxAttempts: 1,
              initialDelay: { seconds: 0 },
              backoffRate: 1,
              jitter: JitterStrategy.NONE,
            }),
          },
        );

        // audit depends on charge via an INLINE (typed) dep and uses ALL_DONE so
        // it runs even though charge FAILED. It reads charge from the resolved
        // deps map: for a dependency that did not SUCCEED the SDK resolves the
        // value to `undefined` (absent), never a stale/fabricated value. audit
        // returns "absent" when it observes that, "present" otherwise.
        d.step(
          "audit",
          [charge],
          async (deps): Promise<string> =>
            (deps as { charge?: string }).charge === undefined
              ? "absent"
              : "present",
        ).triggerRule("ALL_DONE");
      },
      { maxConcurrency: 1 },
    );

    return {
      reason: result.completionReason,
      statuses: {
        charge: result.getStatus("charge"),
        audit: result.getStatus("audit"),
      },
      counts: [
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ],
      audit: result.getResult("audit"),
    };
  },
);
