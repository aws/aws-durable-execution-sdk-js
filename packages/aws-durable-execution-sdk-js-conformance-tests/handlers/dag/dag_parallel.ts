// 10-7: DAG task that is a parallel of two named branches, plus a dependent
// step that reads ONLY the aggregate ParallelResult (no per-branch values).
import {
  DurableContext,
  withDurableExecution,
  BatchResult,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "paralleldag",
      (d) => {
        // DAG task whose native op is a parallel of two named branches, each
        // running one step. Checkpointed directly under the Dag container
        // (flat). maxConcurrency 1 keeps branches sequential.
        const fork = d.parallel<"fork", [], string>(
          "fork",
          [],
          [
            { name: "left", func: async (ctx) => ctx.step(async () => "L") },
            { name: "right", func: async (ctx) => ctx.step(async () => "R") },
          ],
          { maxConcurrency: 1 },
        );

        // Downstream step depending on the parallel task. It reads ONLY the
        // aggregate result (success count / total branch count) and never
        // touches individual branch values — the shape all four SDKs express.
        d.step("join", [fork], async (deps): Promise<string> => {
          const batch = deps.fork as BatchResult<string>;
          return `${batch.successCount}/${batch.totalCount}`;
        });
      },
      { maxConcurrency: 1 },
    );

    return {
      reason: result.completionReason,
      statuses: {
        fork: result.getStatus("fork"),
        join: result.getStatus("join"),
      },
      counts: [
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ],
      join: result.getResult("join"),
    };
  },
);
