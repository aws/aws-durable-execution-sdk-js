// 10-19: DAG custom result-based completion. A rules-engine predicate
// short-circuits the moment any task's SUCCEEDED result carries a REJECT
// verdict -- expressible only because the custom-completion predicate can
// inspect task RESULTS, not just aggregate counts.
import {
  DurableContext,
  withDurableExecution,
  CompletionOutcome,
  completeBatch,
  continueBatch,
  DagCompletionStatus,
} from "@aws/durable-execution-sdk-js";

type Verdict = { verdict: "ACCEPT" | "REJECT" };

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "rulesengine",
      (d) => {
        const r1 = d.step(
          "r1",
          [],
          async (): Promise<Verdict> => ({ verdict: "ACCEPT" }),
        );
        const r2 = d.step(
          "r2",
          [r1],
          async (): Promise<Verdict> => ({ verdict: "REJECT" }),
        );
        d.step(
          "r3",
          [r2],
          async (): Promise<Verdict> => ({
            verdict: "ACCEPT",
          }),
        );
      },
      {
        maxConcurrency: 1,
        completionConfig: {
          shouldComplete: (status: DagCompletionStatus) => {
            const rejected = status.items.some(
              (i) =>
                i.status === "SUCCEEDED" &&
                (i.result as Verdict | undefined)?.verdict === "REJECT",
            );
            return rejected
              ? completeBatch(CompletionOutcome.FAILED)
              : continueBatch();
          },
        },
      },
    );

    return {
      reason: result.completionReason,
      counts: [
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ],
      r1: result.getResult("r1"),
      r2: result.getResult("r2"),
    };
  },
);
