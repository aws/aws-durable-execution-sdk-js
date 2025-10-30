import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Basic Parallel",
  description: "Running multiple operations in parallel",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const results = await context.parallel(
      "parallel",
      [
        async (childContext) => {
          return await childContext.step(async () => {
            return "task 1 completed";
          });
        },
        async (childContext) => {
          return await childContext.step(async () => {
            return "task 2 completed";
          });
        },
        async (childContext) => {
          await childContext.wait(1);
          return "task 3 completed after wait";
        },
      ],
      {
        maxConcurrency: 2,
      },
    );

    return results.getResults();
  },
);
