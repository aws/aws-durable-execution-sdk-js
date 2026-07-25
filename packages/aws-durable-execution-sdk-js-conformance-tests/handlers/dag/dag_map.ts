// 10-6: DAG task that is a map over a fixed item list, plus a dependent step
import {
  DurableContext,
  withDurableExecution,
  BatchResult,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "mapdag",
      (d) => {
        // DAG task whose native op is a map over [1, 2]; each item runs one
        // step returning item*item. Checkpointed directly under the Dag
        // container (flat). maxConcurrency 1 keeps iterations sequential.
        const squares = d.map(
          "squares",
          [],
          [1, 2],
          async (ctx: DurableContext, item: number): Promise<number> =>
            ctx.step(async (): Promise<number> => item * item),
          { maxConcurrency: 1 },
        );

        // Downstream step depending on the map task's aggregated results.
        d.step("sum", [squares], async (deps): Promise<number> => {
          const batch = deps.squares as BatchResult<number>;
          return batch.getResults().reduce((acc, n) => acc + n, 0);
        });
      },
      { maxConcurrency: 1 },
    );

    return {
      reason: result.completionReason,
      statuses: {
        squares: result.getStatus("squares"),
        sum: result.getStatus("sum"),
      },
      counts: [
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ],
      sum: result.getResult("sum"),
    };
  },
);
