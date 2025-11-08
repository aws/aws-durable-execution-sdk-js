import {
  withDurableExecution,
  DurableContext,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Parallel Heterogeneous",
  description: "Running parallel branches with different return types",
};

export const handler = withDurableExecution(
  async (_event, context: DurableContext) => {
    // Parallel branches with different return types
    const results = await context.parallel("parallel-heterogeneous", [
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
    ]);

    return results.getResults();
  },
);
