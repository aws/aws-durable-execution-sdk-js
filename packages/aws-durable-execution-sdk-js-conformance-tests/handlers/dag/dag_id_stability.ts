// 10-20: DAG task-ID stability across independently forced completion orders.
//
// Identical to 10-13's overlap shape (root -> {a, b} -> {afterA, afterB} ->
// merge, unbounded concurrency) EXCEPT which sibling sleeps longer is driven
// by Input.swap: swap=false makes `a` finish first; swap=true makes `b`
// finish first. Both invocations register the SAME task names in the SAME
// order every time -- only the RUNTIME completion order changes.
//
// This is the harness-level counterpart to 10-13: 10-13 proves out-of-order
// completion doesn't fail the execution (an indirect proof of name-based
// ids, since a counter-based scheme would trip the SDK's own
// replay-consistency check). This scenario is invoked TWICE by a dedicated
// script (id_stability.py, not the normal single-invocation validator) with
// swap flipped between runs, and asserts each task's `Id` field in the
// captured execution history is IDENTICAL across both runs -- the direct
// proof that ids are derived from the task NAME, not from completion order
// or a monotonic counter.
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    const swap = Boolean((event as { swap?: boolean } | undefined)?.swap);

    const result = await context.dag("idstabilitydag", (d) => {
      const root = d.step("root", [], async (): Promise<number> => 1);

      // swap=false: a finishes first (~200ms vs ~2000ms).
      // swap=true:  b finishes first (~200ms vs ~2000ms).
      const a = d.step("a", [root], async (): Promise<string> => {
        await sleep(swap ? 2000 : 200);
        return "A";
      });
      const b = d.step("b", [root], async (): Promise<string> => {
        await sleep(swap ? 200 : 2000);
        return "B";
      });

      const afterA = d.step(
        "afterA",
        [a],
        async (deps): Promise<string> => (deps.a as string) + "a",
      );
      const afterB = d.step(
        "afterB",
        [b],
        async (deps): Promise<string> => (deps.b as string) + "b",
      );

      d.step(
        "merge",
        [afterA, afterB],
        async (deps): Promise<string> =>
          (deps.afterA as string) + (deps.afterB as string),
      );
    });

    return {
      reason: result.completionReason,
      statuses: {
        root: result.getStatus("root"),
        a: result.getStatus("a"),
        b: result.getStatus("b"),
        afterA: result.getStatus("afterA"),
        afterB: result.getStatus("afterB"),
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
