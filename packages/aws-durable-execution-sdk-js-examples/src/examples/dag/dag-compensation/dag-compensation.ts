import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Dag Compensation",
  description:
    "Trigger-rule based compensation: a failing charge drives ALL_FAILED refund, skips the ALL_SUCCESS fulfillment, and always runs an ALL_DONE audit",
};

/**
 * Saga-style compensation driven entirely by trigger rules:
 *
 *   charge (fails, no retry)
 *     |-- fulfill  (ALL_SUCCESS)  -> SKIPPED  (charge did not succeed)
 *     |-- refund   (ALL_FAILED)   -> runs     (charge failed)
 *     |-- audit    (ALL_DONE)     -> runs     (charge reached a terminal state)
 *
 * The DAG drains by default (does not reject on task failure); the aggregate
 * completionReason becomes COMPLETED_WITH_FAILURES.
 */
export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag("payment", (d) => {
      const charge = d.step(
        "charge",
        [],
        async (): Promise<string> => {
          throw new Error("card declined");
        },
        { retryStrategy: () => ({ shouldRetry: false }) },
      );

      // ALL_SUCCESS (default): only runs if charge succeeded -> skipped here.
      d.step("fulfill", [charge], async (): Promise<string> => "fulfilled");

      // ALL_FAILED: compensating action, runs because charge failed.
      d.step("refund", [], async (): Promise<string> => "refunded")
        .after(charge)
        .triggerRule("ALL_FAILED");

      // ALL_DONE: always runs once charge reaches a terminal state.
      d.step("audit", [], async (): Promise<string> => "audited")
        .after(charge)
        .triggerRule("ALL_DONE");
    });

    return {
      completionReason: result.completionReason,
      chargeStatus: result.getStatus("charge"),
      fulfillStatus: result.getStatus("fulfill"),
      refundStatus: result.getStatus("refund"),
      refund: result.getResult("refund"),
      auditStatus: result.getStatus("audit"),
      audit: result.getResult("audit"),
      successCount: result.successCount,
      failureCount: result.failureCount,
      skippedCount: result.skippedCount,
    };
  },
);
