import {
  DurableContext,
  withDurableExecution,
  completeBatch,
  CompletionOutcome,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Concurrent Cancellation",
  description:
    "Sibling branches are cancelled when a batch completes early. In " +
    "'min-successful' mode a concurrency-capped parallel stops as soon as " +
    "minSuccessful is reached: an in-flight branch is left STARTED and later " +
    "branches never launch, so they are absent from the result. In 'guard' " +
    "mode a shouldComplete predicate completes the batch as FAILED before any " +
    "branch starts (a pre-flight guard), yielding an empty result whose " +
    "throwIfError raises a BatchCompletionError.",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const mode: string = event?.mode ?? "min-successful";

    if (mode === "guard") {
      // A pre-flight guard: the predicate declines the batch up front, before
      // any branch is started. No branch runs; the batch is empty and marked
      // FAILED. Uses the named `parallel(name, branches, config)` overload.
      const results = await context.parallel(
        "guarded-batch",
        [
          async () => "branch A",
          async () => "branch B",
          async () => "branch C",
        ],
        {
          completionConfig: {
            shouldComplete: () => completeBatch(CompletionOutcome.FAILED),
          },
        },
      );

      // No item failed (none ran), but a FAILED custom completion makes the
      // batch status FAILED, so throwIfError raises a BatchCompletionError.
      let thrownErrorType: string | undefined;
      try {
        results.throwIfError();
      } catch (err) {
        thrownErrorType = (err as { errorType?: string }).errorType;
      }

      return {
        thrownErrorType,
        status: results.status,
        completionReason: results.completionReason,
        totalCount: results.totalCount,
        startedCount: results.startedCount,
      };
    }

    // "min-successful": cap concurrency at 2 and stop once one branch succeeds.
    // Uses the unnamed `parallel(branches, config)` overload. Branch 0 is fast
    // and satisfies minSuccessful; branch 1 is still in flight (STARTED) at that
    // point, and branches 2 and 3 are never launched. Plain timers (not
    // ctx.step) keep the completion ordering observable, matching the other
    // early-completion examples.
    const results = await context.parallel(
      [
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return "branch 0 (fast)";
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return "branch 1 (slow, in flight)";
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return "branch 2 (never started)";
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return "branch 3 (never started)";
        },
      ],
      {
        maxConcurrency: 2,
        completionConfig: {
          minSuccessful: 1,
        },
      },
    );

    await context.wait({ seconds: 1 });

    log(`Completed with ${results.successCount} successes`);
    log(`Completion reason: ${results.completionReason}`);

    return {
      completionReason: results.completionReason,
      successCount: results.successCount,
      startedCount: results.startedCount,
      totalCount: results.totalCount,
      results: results.getResults(),
    };
  },
);
