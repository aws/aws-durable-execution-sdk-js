import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Run In Child Context Checkpoint Size Limit Boundary",
  description:
    "Test runInChildContext with 100 iterations near 256KB limit to verify ReplayChildren boundary behavior",
};

// 256KB limit from run-in-child-context-handler.ts
const CHECKPOINT_SIZE_LIMIT = 256 * 1024;

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Create 100 child contexts with payloads near the 256KB checkpoint limit
    const promises = [];
    for (let i = 0; i < 100; i++) {
      const payloadSize = CHECKPOINT_SIZE_LIMIT - 10 + i; // Range: LIMIT-10 to LIMIT+89

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
      totalIterations: 100,
    };
  },
);
