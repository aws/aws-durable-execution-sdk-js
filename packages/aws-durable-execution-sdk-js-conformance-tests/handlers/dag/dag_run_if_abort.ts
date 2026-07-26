// 10-12: DAG runIf abort path — a throwing predicate FAILS the whole DAG.
//
// A throwing `runIf` is a defect in deterministic predicate code, not a
// business outcome. The scheduler aborts with a typed DagPredicateError: the
// offending task gets no terminal state, no further task starts, and the Dag
// container checkpoints a failure. We deliberately do NOT catch the error —
// the abort must propagate so the execution FAILS on the wire
// (ContextStarted SubType=Dag → gate started+succeeded → ContextFailed
// SubType=Dag), which is the entire point of this scenario. Serial
// (maxConcurrency 1) so it keeps full history assertions.
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    await context.dag(
      "abortdag",
      (d) => {
        // Root: runs and succeeds.
        const gate = d.step("gate", [], async (): Promise<number> => 1);

        // Its runIf throws. The body would return "ran" but MUST NOT run.
        const guarded = d.step(
          "guarded",
          [gate],
          async (): Promise<string> => "ran",
          {
            runIf: (): boolean => {
              throw new Error("predicate boom");
            },
          },
        );

        // ALL_FAILED compensation on an ordering-only edge. It MUST NOT run:
        // a predicate defect must never drive compensation. The abort halts
        // the scheduler before this task is ever evaluated.
        d.step("refund", [], async (): Promise<string> => "refunded")
          .after(guarded)
          .triggerRule("ALL_FAILED");
      },
      { maxConcurrency: 1 },
    );
  },
);
