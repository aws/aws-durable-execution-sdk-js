import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Parallel minSuccessful",
  description: "Parallel execution with minSuccessful completion config",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    log("Starting parallel execution with minSuccessful: 2");

    // Using ctx.step here will prevent us to check minSuccessful if we are trying
    // to use timeout that is close to checkpopint call latency
    // The reason is ctx.step is doing checkpoint synchronously and multiple
    // steps in multiple iterations/branches could finish before map/parallel completion is met

    const results = await context.parallel(
      "min-successful-branches",
      [
        {
          name: "branch-1",
          func: async (ctx) => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return "Branch 1 result";
          },
        },
        {
          name: "branch-2",
          func: async (ctx) => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return "Branch 2 result";
          },
        },
        {
          name: "branch-3",
          func: async (ctx) => {
            await new Promise((resolve) => setTimeout(resolve, 300));
            return "Branch 3 result";
          },
        },
        {
          name: "branch-4",
          func: async (ctx) => {
            await new Promise((resolve) => setTimeout(resolve, 400));
            return "Branch 4 result";
          },
        },
      ],
      {
        completionConfig: {
          minSuccessful: 2,
        },
      },
    );

    await context.wait({ seconds: 1 });

    log(`Completed with ${results.successCount} successes`);
    log(`Completion reason: ${results.completionReason}`);

    return {
      successCount: results.successCount,
      totalCount: results.totalCount,
      completionReason: results.completionReason,
      results: results.getResults(),
    };
  },
);
