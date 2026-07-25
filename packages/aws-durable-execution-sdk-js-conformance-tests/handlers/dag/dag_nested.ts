// 10-9: DAG task that is itself a nested DAG (sub-dag)
import {
  DurableContext,
  withDurableExecution,
  DagResult,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "outerdag",
      (d) => {
        // Upstream step feeding the nested DAG.
        const pre = d.step("pre", [], async (): Promise<number> => 1);

        // DAG task whose native op is itself a nested DAG (2-node graph).
        // Checkpointed directly under the outer Dag container (flat), and its
        // own tasks are checkpointed under the nested Dag container.
        const sub = d.dag("sub", [pre], (nd) => {
          const n1 = nd.step("n1", [], async (): Promise<number> => 2);
          nd.step(
            "n2",
            [n1],
            async (deps): Promise<number> => (deps.n1 as number) + 3,
          );
        });

        // Downstream step reading the nested DAG's result.
        d.step("post", [sub], async (deps): Promise<number> => {
          const nested = deps.sub as DagResult;
          return (nested.getResult("n2") as number) * 10;
        });
      },
      { maxConcurrency: 1 },
    );

    return {
      reason: result.completionReason,
      statuses: {
        pre: result.getStatus("pre"),
        sub: result.getStatus("sub"),
        post: result.getStatus("post"),
      },
      counts: [
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ],
      post: result.getResult("post"),
    };
  },
);
