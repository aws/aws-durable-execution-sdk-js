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
    try {
      const result = await context.step(
        "InterruptedStep",
        async () => {
          // Simulate a long-running operation that gets interrupted
          await new Promise((resolve) => setTimeout(resolve, 10000)); // 10 seconds
          return "This should not complete";
        },
        {
          semantics: StepSemantics.AtMostOncePerRetry,
          retryStrategy: () => ({ shouldRetry: false }),
        },
      );
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: {
          name: (error as Error).name,
          message: (error as Error).message,
        },
      };
    }
  },
);
