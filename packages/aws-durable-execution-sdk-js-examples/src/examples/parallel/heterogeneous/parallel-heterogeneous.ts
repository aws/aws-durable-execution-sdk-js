import {
  type BatchResult,
  withDurableExecution,
  DurableContext,
  type DurablePromise,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Parallel Heterogeneous",
  description: "Running parallel branches with different return types",
};

export const handler = withDurableExecution(
  async (_event, context: DurableContext) => {
    // Parallel branches with different return types. The result type is the
    // union of the branch result types. Like every durable operation, parallel
    // returns a DurablePromise.
    const pending: DurablePromise<
      BatchResult<{ step1: string } | string | number>
    > = context.parallel("parallel-heterogeneous", [
      async (childContext: DurableContext) => {
        return await childContext.step(async () => {
          return { step1: "completed" };
        });
      },
      async (childContext: DurableContext) => {
        return await childContext.step(async () => {
          return "task 2 completed";
        });
      },
      async (childContext: DurableContext) => {
        return await childContext.step(async () => {
          return 42;
        });
      },
    ] as const);

    const results = await pending;

    return results.getResults();
  },
);
