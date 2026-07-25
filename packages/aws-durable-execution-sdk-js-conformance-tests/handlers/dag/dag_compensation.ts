// 10-2: DAG trigger-rule compensation (COMPLETED_WITH_FAILURES)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "compensation",
      (d) => {
        // charge always fails; uses the SDK default retry policy (no override),
        // exhausting attempts across suspend/resume before failing terminally.
        const charge = d.step("charge", [], async (): Promise<string> => {
          throw new Error("payment declined");
        });

        // Default trigger (ALL_SUCCESS): skipped because charge failed.
        d.step("fulfill", [charge], async (): Promise<string> => "fulfilled");

        // AllFailed trigger: runs because charge failed.
        d.step("refund", [], async (): Promise<string> => "refunded")
          .after(charge)
          .triggerRule("ALL_FAILED");

        // AllDone trigger: runs regardless of charge's terminal state.
        d.step("audit", [], async (): Promise<string> => "logged")
          .after(charge)
          .triggerRule("ALL_DONE");
      },
      { maxConcurrency: 1 },
    );

    return {
      reason: result.completionReason,
      statuses: {
        charge: result.getStatus("charge"),
        fulfill: result.getStatus("fulfill"),
        refund: result.getStatus("refund"),
        audit: result.getStatus("audit"),
      },
      counts: [
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ],
    };
  },
);
