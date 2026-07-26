// 10-13: DAG concurrent overlap — real in-flight overlap inside one invocation.
//
// maxConcurrency is UNSET, so `slow` and `fast` run concurrently off the same
// root. `slow` is registered first but finishes LAST, and `afterSlow` is
// registered before `afterFast` yet `afterFast` becomes ready — and therefore
// starts — FIRST. That inversion of registration order versus start order is
// exactly the condition a counter-based task-id scheme cannot survive: under
// out-of-order completion a counter hands out different ids on replay and the
// execution fails a replay-consistency check. Name-based ids make the outcome
// order-invariant, so this scenario asserts outcome only (status, result,
// counts, observed peak concurrency) and never event ids or ordering.
//
// Peak-concurrency instrumentation: a shared counter incremented on entry to
// `slow`/`fast` and decremented on exit, tracking the maximum observed. JS
// bodies interleave at their `await`, so no lock is needed here; the sleeps are
// real awaited timers so the overlap genuinely occurs.
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    let active = 0;
    let peakConcurrency = 0;
    const enter = (): void => {
      active += 1;
      if (active > peakConcurrency) {
        peakConcurrency = active;
      }
    };
    const exit = (): void => {
      active -= 1;
    };

    const result = await context.dag("overlapdag", (d) => {
      const root = d.step("root", [], async (): Promise<number> => 1);

      // Register `slow` FIRST; it finishes last (~2s vs ~200ms).
      const slow = d.step("slow", [root], async (): Promise<string> => {
        enter();
        try {
          await sleep(2000);
          return "S";
        } finally {
          exit();
        }
      });
      const fast = d.step("fast", [root], async (): Promise<string> => {
        enter();
        try {
          await sleep(200);
          return "F";
        } finally {
          exit();
        }
      });

      // Register `afterSlow` FIRST so `afterFast` becomes ready — and starts —
      // first: registration order inverted versus start order.
      const afterSlow = d.step(
        "afterSlow",
        [slow],
        async (deps): Promise<string> => (deps.slow as string) + "s",
      );
      const afterFast = d.step(
        "afterFast",
        [fast],
        async (deps): Promise<string> => (deps.fast as string) + "f",
      );

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
      peakConcurrency,
    };
  },
);
