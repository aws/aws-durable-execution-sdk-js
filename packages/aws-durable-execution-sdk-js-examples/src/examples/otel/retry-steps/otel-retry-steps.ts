import {
  DurableContext,
  withDurableExecution,
  createRetryStrategy,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createOtelTestSetup } from "../shared/otel-test-setup";

const { plugin, getSerializedSpans } = createOtelTestSetup();

export const config: ExampleConfig = {
  name: "OTel Retry Steps",
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    // Step that always fails, exercising the retry mechanism until retries
    // are exhausted. This avoids needing state that persists across invocations.
    let stepError: unknown;
    try {
      await context.step(
        "retry-step",
        async () => {
          throw new Error("always fails");
        },
        {
          retryStrategy: createRetryStrategy({
            maxAttempts: 3,
            initialDelay: { seconds: 1 },
            backoffRate: 1,
          }),
        },
      );
    } catch (error) {
      stepError = error;
    }

    return {
      failed: true,
      errorMessage:
        stepError instanceof Error ? stepError.message : String(stepError),
      spans: getSerializedSpans(),
    };
  },
  { plugins: [plugin] },
);
