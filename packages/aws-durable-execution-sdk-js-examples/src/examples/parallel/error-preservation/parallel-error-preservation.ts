import {
  DurableContext,
  withDurableExecution,
  CallbackError,
  InvokeError,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Parallel Error Preservation",
  description:
    "Demonstrates that errors thrown in parallel branches preserve their original type and message",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const results = await context.parallel("parallel-with-errors", [
      async (childContext) => {
        return await childContext.step(
          "success-task",
          async () => {
            return "task completed successfully";
          },
          { retryStrategy: () => ({ shouldRetry: false }) },
        );
      },
      async (childContext) => {
        return await childContext.step(
          "callback-error-task",
          async () => {
            throw new CallbackError("Custom callback error message");
          },
          { retryStrategy: () => ({ shouldRetry: false }) },
        );
      },
    ]);

    // Collect errors to verify they preserve original type and message
    const errors = results.getErrors();
    const errorInfo = errors.map((error) => ({
      type: (error as any).errorType,
      message: error.message,
      originalType: (error.cause as any)?.errorType,
      originalMessage: error.cause?.message,
    }));

    return {
      success: results.succeeded().map((item) => item.result),
      errors: errorInfo,
      totalErrors: errors.length,
    };
  },
);
