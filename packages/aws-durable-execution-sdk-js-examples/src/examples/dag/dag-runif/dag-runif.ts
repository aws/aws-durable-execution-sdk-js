import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Dag RunIf",
  description:
    "Conditional branching with runIf predicates over an upstream task's result",
};

/**
 * runIf branching: a `classify` task produces a label, and three downstream
 * branches each declare a deterministic `runIf` predicate over that label.
 * Only the matching branch runs; the others are skipped with skipReason
 * RUN_IF_PREDICATE.
 */
export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag("moderation", (d) => {
      const classify = d.step(
        "classify",
        [],
        async (): Promise<string> => "safe",
      );

      d.step("publish", [classify], async (): Promise<string> => "published", {
        runIf: (deps) => deps.classify === "safe",
      });
      d.step("review", [classify], async (): Promise<string> => "reviewed", {
        runIf: (deps) => deps.classify === "review",
      });
      d.step("blocked", [classify], async (): Promise<string> => "blocked", {
        runIf: (deps) => deps.classify === "block",
      });
    });

    return {
      completionReason: result.completionReason,
      classify: result.getResult("classify"),
      publish: result.getResult("publish"),
      publishStatus: result.getStatus("publish"),
      reviewStatus: result.getStatus("review"),
      blockedStatus: result.getStatus("blocked"),
      successCount: result.successCount,
      skippedCount: result.skippedCount,
    };
  },
);
