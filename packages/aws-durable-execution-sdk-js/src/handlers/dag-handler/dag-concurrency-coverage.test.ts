/**
 * Concurrency + abort coverage integration tests (TypeScript).
 *
 * These close review findings H7/H8 and the runIf-abort wire gap locally, using
 * the same in-process driver (`createTestDurableContext`) the other DAG tests
 * use — so the regressions are caught without a cloud deploy. They mirror the
 * `10-12`..`10-14` conformance handlers exactly (same DAG names, task names,
 * values and registration order), but additionally assert the one thing the
 * cloud suite deliberately cannot: that every task's operation id is
 * name-based (`DAG_NODE_T_<name>`). Under out-of-order completion a counter
 * regression would both fail the id assertion here AND fail a replay-
 * consistency check on the wire.
 */
import { createTestDurableContext } from "../../testing/create-test-durable-context";
import { DagPredicateError } from "../../errors/dag-errors/dag-errors";

const str = (v: unknown): string => v as string;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("DAG concurrency + abort coverage (TypeScript)", () => {
  it("10-13 concurrent overlap: real overlap, name-based ids, outcome-only", async () => {
    const { context } = createTestDurableContext();

    // Peak-concurrency instrumentation. JS bodies interleave at their await, so
    // a plain counter is sufficient — no lock needed.
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

      // Register `slow` FIRST; it finishes LAST. Real awaited timers so the
      // overlap genuinely occurs (shortened vs the ~2s/~200ms handler, but the
      // slow:fast ratio is preserved so `fast` still finishes first).
      const slow = d.step("slow", [root], async (): Promise<string> => {
        enter();
        try {
          await sleep(100);
          return "S";
        } finally {
          exit();
        }
      });
      const fast = d.step("fast", [root], async (): Promise<string> => {
        enter();
        try {
          await sleep(20);
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
        async (deps): Promise<string> => str(deps.slow) + "s",
      );
      const afterFast = d.step(
        "afterFast",
        [fast],
        async (deps): Promise<string> => str(deps.fast) + "f",
      );

      d.step(
        "merge",
        [afterSlow, afterFast],
        async (deps): Promise<string> =>
          str(deps.afterSlow) + str(deps.afterFast),
      );
    });

    // Outcome — order-invariant, holds regardless of who finishes first.
    expect(result.completionReason).toBe("ALL_COMPLETED");
    expect(result.getResult("merge")).toBe("SsFf");
    expect([
      result.successCount,
      result.failureCount,
      result.skippedCount,
      result.totalCount,
    ]).toEqual([6, 0, 0, 6]);
    for (const name of [
      "root",
      "slow",
      "fast",
      "afterSlow",
      "afterFast",
      "merge",
    ]) {
      expect(result.getStatus(name)).toBe("SUCCEEDED");
    }

    // The overlap genuinely occurred: `slow` and `fast` were both in-flight at
    // the same time. Without concurrency this would be 1.
    expect(peakConcurrency).toBeGreaterThanOrEqual(2);

    // The id assertion the cloud suite cannot make: every task's operation id
    // is name-based, carrying the DAG_NODE_T_<its own name> segment. A counter
    // regression would fail here (and fail replay-consistency on the wire).
    for (const name of [
      "root",
      "slow",
      "fast",
      "afterSlow",
      "afterFast",
      "merge",
    ]) {
      expect(context.createTaskId(name)).toContain(`DAG_NODE_T_${name}`);
    }
  });

  it("10-14 inverted readiness across a suspend: result holds, no replay error", async () => {
    const { context } = createTestDurableContext();

    // Same graph as the 10-14 handler. In the in-process harness the Wait tasks
    // resolve without a real timer (virtual time), so we assert the order-
    // invariant outcome and that no replay-consistency error is thrown.
    const run = context.dag("suspenddag", (d) => {
      const root = d.step("root", [], async (): Promise<number> => 1);

      // Register `slow` (8s) FIRST; `fast` (2s) resumes first on the wire.
      const slow = d.wait("slow", [root], { seconds: 8 });
      const fast = d.wait("fast", [root], { seconds: 2 });

      // Register `afterSlow` FIRST; `afterFast` becomes ready first.
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
          str(deps.afterSlow) + str(deps.afterFast),
      );
    });

    // No replay-consistency error is thrown while resolving the DAG.
    const result = await run;

    expect(result.completionReason).toBe("ALL_COMPLETED");
    expect(result.getResult("merge")).toBe("SF");
    expect([
      result.successCount,
      result.failureCount,
      result.skippedCount,
      result.totalCount,
    ]).toEqual([6, 0, 0, 6]);
    for (const name of [
      "root",
      "slow",
      "fast",
      "afterSlow",
      "afterFast",
      "merge",
    ]) {
      expect(result.getStatus(name)).toBe("SUCCEEDED");
    }

    // Name-based ids across the suspend boundary too.
    for (const name of [
      "root",
      "slow",
      "fast",
      "afterSlow",
      "afterFast",
      "merge",
    ]) {
      expect(context.createTaskId(name)).toContain(`DAG_NODE_T_${name}`);
    }
  });

  it("10-12 abort: a throwing runIf FAILS the DAG and never drives compensation", async () => {
    const { context } = createTestDurableContext();

    // External counters — the harness's checkpoint is a no-op, so these bodies
    // are the only reliable evidence of whether a task ran.
    let gateRan = 0;
    let guardedRan = 0;
    let refundRan = 0;

    let caught: unknown;
    try {
      await context.dag(
        "abortdag",
        (d) => {
          const gate = d.step("gate", [], async (): Promise<number> => {
            gateRan += 1;
            return 1;
          });

          const guarded = d.step(
            "guarded",
            [gate],
            async (): Promise<string> => {
              guardedRan += 1;
              return "ran";
            },
            {
              runIf: (): boolean => {
                throw new Error("predicate boom");
              },
            },
          );

          d.step("refund", [], async (): Promise<string> => {
            refundRan += 1;
            return "refunded";
          })
            .after(guarded)
            .triggerRule("ALL_FAILED");
        },
        { maxConcurrency: 1 },
      );
    } catch (error) {
      caught = error;
    }

    // The DAG aborts with the typed predicate error.
    expect(caught).toBeInstanceOf(DagPredicateError);
    // The message names the offending task and its cause — the structured
    // taskName/cause fields are erased by the child-context boundary, so the
    // message is what a caller awaiting dag() can rely on.
    expect((caught as Error).message).toContain("guarded");
    expect((caught as Error).message).toContain("predicate boom");

    // `gate` ran; the guarded body MUST NOT run (its predicate threw before the
    // body); and the ALL_FAILED compensation MUST NOT run — a predicate defect
    // must never drive compensation.
    expect(gateRan).toBe(1);
    expect(guardedRan).toBe(0);
    expect(refundRan).toBe(0);
  });
});
