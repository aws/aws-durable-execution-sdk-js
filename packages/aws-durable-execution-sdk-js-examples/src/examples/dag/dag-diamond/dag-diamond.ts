import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Dag Diamond",
  description:
    "A diamond-shaped DAG (fan-out then fan-in) with typed dependency results",
};

/**
 * Diamond DAG:
 *
 *        fetch
 *        /    \
 *       a      b
 *        \    /
 *        merge
 *
 * `a` and `b` fan out from `fetch` and run concurrently; `merge` fans them
 * back in, receiving both results through its typed {@link DepsMap}. All task
 * bodies are deterministic so the execution replays identically.
 */
export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag("diamond", (d) => {
      const fetch = d.step("fetch", [], async (): Promise<number> => 10);
      const a = d.step("a", [fetch], async (deps): Promise<number> => {
        return deps.fetch + 1;
      });
      const b = d.step("b", [fetch], async (deps): Promise<number> => {
        return deps.fetch + 2;
      });
      d.step("merge", [a, b], async (deps): Promise<number> => {
        return deps.a + deps.b;
      });
    });

    return {
      merge: result.getResult("merge"),
      completionReason: result.completionReason,
      successCount: result.successCount,
      totalCount: result.totalCount,
    };
  },
);
