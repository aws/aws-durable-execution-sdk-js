import {
  DurableContext,
  withDurableExecution,
  StepSemantics,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Step Interrupted No Retry",
  description:
    "AtMostOncePerRetry step that gets interrupted and doesn't retry",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(
      "ErrorStep",
      async () => {
        throw new Error("Test error for shouldRetry false");
      },
      {
        semantics: StepSemantics.AtMostOncePerRetry,
        retryStrategy: () => ({ shouldRetry: false }),
      },
    );
    return { success: true, result };
  },
);
