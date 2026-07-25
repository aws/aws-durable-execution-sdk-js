// 10-1: DAG diamond fan-out/fan-in (all tasks complete)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "diamond",
      (d) => {
        const fetch = d.step("fetch", [], async (): Promise<number> => 10);
        const ta = d.step(
          "ta",
          [fetch],
          async (deps): Promise<number> => (deps.fetch as number) + 1,
        );
        const tb = d.step(
          "tb",
          [fetch],
          async (deps): Promise<number> => (deps.fetch as number) * 2,
        );
        d.step(
          "merge",
          [ta, tb],
          async (deps): Promise<number> =>
            (deps.ta as number) + (deps.tb as number),
        );
      },
      { maxConcurrency: 1 },
    );

    return {
      reason: result.completionReason,
      statuses: {
        fetch: result.getStatus("fetch"),
        ta: result.getStatus("ta"),
        tb: result.getStatus("tb"),
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
