// 10-3: DAG per-task conditional execution (WithRunIf)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "runif",
      (d) => {
        const classify = d.step(
          "classify",
          [],
          async (): Promise<string> => "review",
        );
        // Each branch runs only when classify's result equals its own name.
        d.step("publish", [classify], async (): Promise<string> => "publish", {
          runIf: (deps) => deps.classify === "publish",
        });
        d.step("review", [classify], async (): Promise<string> => "review", {
          runIf: (deps) => deps.classify === "review",
        });
        d.step("block", [classify], async (): Promise<string> => "block", {
          runIf: (deps) => deps.classify === "block",
        });
      },
      { maxConcurrency: 1 },
    );

    const branch = ["publish", "review", "block"].find(
      (b) => result.getStatus(b) === "SUCCEEDED",
    );

    return {
      reason: result.completionReason,
      statuses: {
        classify: result.getStatus("classify"),
        review: result.getStatus("review"),
        publish: result.getStatus("publish"),
        block: result.getStatus("block"),
      },
      counts: [
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ],
      branch,
    };
  },
);
