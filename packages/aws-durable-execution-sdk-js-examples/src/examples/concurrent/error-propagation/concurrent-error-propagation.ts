import {
  DurableContext,
  withDurableExecution,
  completeBatch,
  continueBatch,
  CompletionOutcome,
  retryPresets,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Concurrent Error Propagation",
  description:
    "How errors from concurrent branches propagate. In 'propagate' mode a " +
    "rejected branch fails the batch (fail-fast) and BatchResult.throwIfError " +
    "re-raises the branch's error, failing the whole execution. In " +
    "'custom-failed' mode a shouldComplete predicate marks the batch FAILED " +
    "once a failure makes the required quorum unreachable, so the batch status " +
    "is FAILED and reports CUSTOM_COMPLETION_FAILED.",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const mode: string = event?.mode ?? "propagate";

    if (mode === "custom-failed") {
      // Quorum: all three items must succeed. Uses the unnamed
      // `map(items, fn, config)` overload. The predicate completes the batch as
      // FAILED as soon as any failure makes the all-succeed quorum impossible.
      const results = await context.map(
        [1, 2, 3],
        async (ctx: DurableContext, item: number, index: number) => {
          return await ctx.step(
            `process-${index}`,
            async () => {
              if (item === 2) {
                throw new Error(`item ${item} failed`);
              }
              return `item ${item} ok`;
            },
            { retryStrategy: retryPresets.noRetry },
          );
        },
        {
          completionConfig: {
            shouldComplete: ({ failureCount }) =>
              failureCount > 0
                ? completeBatch(CompletionOutcome.FAILED)
                : continueBatch(),
          },
        },
      );

      await context.wait({ seconds: 1 });

      // A custom FAILED decision is authoritative for the batch status even
      // though it is surfaced alongside the individual item error.
      return {
        status: results.status,
        completionReason: results.completionReason,
        hasFailure: results.hasFailure,
        failureCount: results.failureCount,
        successCount: results.successCount,
      };
    }

    // "propagate": fail-fast. With no completion config, a single rejected
    // branch fails the batch. throwIfError re-raises the branch's
    // ChildContextError, which propagates out of the handler and fails the
    // whole durable execution.
    const results = await context.parallel("failing-branches", [
      async (ctx: DurableContext) =>
        ctx.step("ok-branch", async () => "ok", {
          retryStrategy: retryPresets.noRetry,
        }),
      async (ctx: DurableContext) =>
        ctx.step(
          "bad-branch",
          async () => {
            throw new Error("branch blew up");
          },
          { retryStrategy: retryPresets.noRetry },
        ),
    ]);

    // Re-raise the first branch error so it becomes the execution's failure.
    results.throwIfError();

    // Not reached — throwIfError always throws here.
    return { unreachable: true };
  },
);
