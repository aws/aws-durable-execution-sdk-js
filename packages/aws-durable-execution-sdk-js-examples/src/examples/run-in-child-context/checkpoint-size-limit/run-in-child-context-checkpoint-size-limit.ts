import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Run In Child Context Checkpoint Size Limit Boundary",
  description:
    "Test runInChildContext with 25 iterations near 256KB limit to verify ReplayChildren boundary behavior",
};

// 256KB limit from run-in-child-context-handler.ts
const CHECKPOINT_SIZE_LIMIT = 256 * 1024;

// Keep the batch small enough to stay well under the execution time budget
// (100 iterations sat on the edge and intermittently TIMED_OUT), while still
// straddling the checkpoint size limit. Sizes are centered on the limit:
// below (LIMIT - 12) -> at (LIMIT) -> above (LIMIT + 12), so both the inline
// and the ReplayChildren (over-limit) checkpoint paths are exercised.
const ITERATIONS = 25;
const SIZE_OFFSET = Math.floor(ITERATIONS / 2); // 12

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Create child contexts with payloads straddling the 256KB checkpoint limit
    const promises = [];
    for (let i = 0; i < ITERATIONS; i++) {
      // Range: LIMIT-12 (below) .. LIMIT (at) .. LIMIT+12 (above)
      const payloadSize = CHECKPOINT_SIZE_LIMIT - SIZE_OFFSET + i;

      const promise = context.runInChildContext(
        `boundary-test-${i}`,
        async () => {
          return "x".repeat(payloadSize);
        },
      );

      promises.push(promise);
    }

    // Await all promises in parallel
    await Promise.all(promises);

    return {
      success: true,
      totalIterations: ITERATIONS,
    };
  },
);
