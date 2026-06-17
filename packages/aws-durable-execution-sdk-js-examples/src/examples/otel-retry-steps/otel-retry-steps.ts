import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";
import { createOtelTestSetup } from "../otel-shared/otel-test-setup";

const { plugin, exporter, getSerializedSpans } = createOtelTestSetup();

export const config: ExampleConfig = {
  name: "OTel Retry Steps",
};

// Module-level counter persists across invocations within the same process.
// This is necessary because each retry attempt may execute in a new invocation
// (due to the replay model), and handler-level variables reset on each invocation.
let attemptCount = 0;

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Note: We intentionally do NOT call exporter.reset() here because
    // retry attempts span multiple invocations and we need to accumulate
    // spans from all invocations to assert on attempt spans for each retry.

    const result = await context.step(
      "retry-step",
      async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error(`Attempt ${attemptCount} failed`);
        }
        return "success-on-attempt-3";
      },
      {
        retryStrategy: (error: Error, attemptsMade: number) => {
          if (attemptsMade <= 3) {
            return { shouldRetry: true, delay: { seconds: 1 } };
          }
          return { shouldRetry: false };
        },
      },
    );

    return { result, spans: getSerializedSpans() };
  },
  { plugins: [plugin] },
);
