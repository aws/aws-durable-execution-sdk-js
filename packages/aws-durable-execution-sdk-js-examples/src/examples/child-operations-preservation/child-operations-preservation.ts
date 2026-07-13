import {
  DurableContext,
  withDurableExecution,
  createRetryStrategy,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Child Operations Preservation",
  description:
    "Verifies pluginsConfig.childOperationsDepth preserves the children of a " +
    "FAILED context across suspend/resume (integration test catches backend " +
    "behavior differences for failed contexts).",
};

// No retries — we want the failing step (and its context) to fail once,
// deterministically, so the run is fast and the shape is predictable.
const noRetry = createRetryStrategy({ maxAttempts: 1 });

/**
 * Runs a child context that fails after doing some child work, swallows the
 * error, then WAITS (forcing a suspend/resume) before finishing.
 *
 * The point of interest is what the execution state contains AFTER the resume:
 * by default the backend prunes a finished context's children, so the failed
 * context's child operations would disappear. `childOperationsDepth` sets
 * `ReplayChildren` (including on the FAIL checkpoint) to keep them. The test
 * asserts the children survive — locally this always holds; against real
 * Lambda it verifies the backend honors `ReplayChildren` on FAILED contexts.
 */
export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    let branchFailed = false;
    try {
      await context.runInChildContext("failing-branch", async (child) => {
        await child.step("child-step-ok", async () => "ok", {
          retryStrategy: noRetry,
        });
        await child.step(
          "child-step-boom",
          async () => {
            throw new Error("intentional child failure");
          },
          { retryStrategy: noRetry },
        );
      });
    } catch {
      // Swallow so the execution itself succeeds; the CONTEXT is what failed.
      branchFailed = true;
    }

    // Force a suspend/resume: on resume the backend hands back a fresh
    // operations payload, which is where pruning of finished contexts' children
    // would happen.
    await context.wait("cooldown", { seconds: 1 });

    return { branchFailed };
  },
  {
    // Preserve one level of nested children (the steps inside failing-branch).
    pluginsConfig: { childOperationsDepth: 1 },
  },
);
