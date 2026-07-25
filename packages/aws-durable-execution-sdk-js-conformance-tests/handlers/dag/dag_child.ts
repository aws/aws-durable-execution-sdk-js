// 10-5: DAG task that is a runInChildContext (upstream + downstream steps)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "childdag",
      (d) => {
        // Upstream step feeding the child-context task.
        const seed = d.step("seed", [], async (): Promise<number> => 1);

        // DAG task whose native op is a runInChildContext running two inner
        // steps. Checkpointed directly under the Dag container (flat).
        const group = d.runInChildContext(
          "group",
          [seed],
          async (deps, childCtx): Promise<number> => {
            const a = await childCtx.step(
              "inner-a",
              async (): Promise<number> => (deps.seed as number) + 1,
            );
            const b = await childCtx.step(
              "inner-b",
              async (): Promise<number> => (deps.seed as number) + 2,
            );
            return a + b;
          },
        );

        // Downstream step depending on the child-context task.
        d.step(
          "done",
          [group],
          async (deps): Promise<number> => (deps.group as number) * 2,
        );
      },
      { maxConcurrency: 1 },
    );

    return {
      reason: result.completionReason,
      statuses: {
        seed: result.getStatus("seed"),
        group: result.getStatus("group"),
        done: result.getStatus("done"),
      },
      counts: [
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ],
      group: result.getResult("group"),
      done: result.getResult("done"),
    };
  },
);
