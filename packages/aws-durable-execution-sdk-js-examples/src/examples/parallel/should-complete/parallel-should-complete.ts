import {
  BatchItemStatus,
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Parallel shouldComplete quorum",
  description:
    "Parallel execution with a custom shouldComplete predicate expressing a " +
    "quorum rule: complete when branch A (index 0) succeeds, OR when both " +
    "branch B (index 1) and branch C (index 2) succeed. Branches are unnamed, " +
    "so the predicate keys off the stable branch index.",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    log("Starting parallel execution with a quorum shouldComplete predicate");

    // Avoid ctx.step here for the same reason as the min-successful examples:
    // ctx.step checkpoints synchronously, so multiple branches could finish
    // before the completion predicate is evaluated. A plain timeout keeps the
    // ordering observable for this timing-based test. Branch A is slow so the
    // (B AND C) arm of the rule is what completes the parallel.
    const results = await context.parallel(
      "quorum-branches",
      [
        // index 0 = branch A (slow)
        async (ctx) => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          return "Branch A done";
        },
        // index 1 = branch B (fast)
        async (ctx) => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return "Branch B done";
        },
        // index 2 = branch C
        async (ctx) => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return "Branch C done";
        },
      ],
      {
        completionConfig: {
          // Complete when branch A succeeds, OR branches B and C both succeed.
          shouldComplete: ({ items }) => {
            const ok = (i: number) =>
              items[i]?.status === BatchItemStatus.SUCCEEDED;
            return ok(0) || (ok(1) && ok(2));
          },
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
