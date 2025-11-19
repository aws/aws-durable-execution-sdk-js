import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Run In Child Context Checkpoint Size Limit Boundary",
  description:
    "Test runInChildContext with 200 iterations near 256KB limit to verify ReplayChildren boundary behavior",
};

// 256KB limit from run-in-child-context-handler.ts
const CHECKPOINT_SIZE_LIMIT = 256 * 1024;

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    console.log(
      "Testing checkpoint size limit boundary with 200 iterations in parallel",
    );

    // Create all promises first - test much closer to the limit to catch serialization overhead
    const promises = [];
    for (let i = 0; i < 200; i++) {
      const payloadSize = CHECKPOINT_SIZE_LIMIT - 10 + i; // Range: LIMIT-10 to LIMIT+189

      const promise = context
        .runInChildContext(`boundary-test-${i}`, async () => {
          return "x".repeat(payloadSize);
        })
        .then((result) => ({
          iteration: i,
          payloadSize,
          resultSize: result.length,
          serializedSize: Buffer.byteLength(JSON.stringify(result), "utf8"),
          isOverLimit: payloadSize >= CHECKPOINT_SIZE_LIMIT,
        }));

      promises.push(promise);
    }

    // Await all promises in parallel
    const results = await Promise.all(promises);

    return {
      success: true,
      message: "Checkpoint size boundary test completed",
      totalIterations: results.length,
      checkpointLimit: CHECKPOINT_SIZE_LIMIT,
      results,
    };
  },
);
