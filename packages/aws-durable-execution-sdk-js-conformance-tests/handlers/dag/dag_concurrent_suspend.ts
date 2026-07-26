// 10-14: DAG concurrent suspend — inverted readiness across a suspend boundary.
//
// maxConcurrency is UNSET. `slow` and `fast` are in-graph Wait tasks (8s and
// 2s) that both start in the FIRST invocation, so the invocation suspends with
// TWO tasks in flight and resumes twice. `afterSlow` is registered before
// `afterFast`, but because `fast` (2s) resumes before `slow` (8s), `afterFast`
// becomes ready one invocation EARLIER — the downstream pair starts in the
// reverse of registration order, across different invocations. This is the
// replay-flip case a counter-based id scheme cannot survive; name-based ids
// keep the outcome order-invariant, so this scenario asserts outcome only.
//
// Timers (not races) decide the order, so the outcome is deterministic. The
// ~6s gap between the two waits must not be shortened. No peak-concurrency
// assertion is possible or needed here — the waits are not user code; the
// suspend boundary is the point.
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag("suspenddag", (d) => {
      const root = d.step("root", [], async (): Promise<number> => 1);

      // Register `slow` (8s) FIRST; `fast` (2s) resumes first.
      const slow = d.wait("slow", [root], { seconds: 8 });
      const fast = d.wait("fast", [root], { seconds: 2 });

      // Register `afterSlow` FIRST; `afterFast` becomes ready one invocation
      // earlier because `fast` resumes first — start order inverts.
      const afterSlow = d
        .step("afterSlow", [], async (): Promise<string> => "S")
        .after(slow);
      const afterFast = d
        .step("afterFast", [], async (): Promise<string> => "F")
        .after(fast);

      d.step(
        "merge",
        [afterSlow, afterFast],
        async (deps): Promise<string> =>
          (deps.afterSlow as string) + (deps.afterFast as string),
      );
    });

    return {
      reason: result.completionReason,
      statuses: {
        root: result.getStatus("root"),
        slow: result.getStatus("slow"),
        fast: result.getStatus("fast"),
        afterSlow: result.getStatus("afterSlow"),
        afterFast: result.getStatus("afterFast"),
        merge: result.getStatus("merge"),
      },
      counts: [
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ],
      merge: result.getResult("merge"),
    };
  },
);
