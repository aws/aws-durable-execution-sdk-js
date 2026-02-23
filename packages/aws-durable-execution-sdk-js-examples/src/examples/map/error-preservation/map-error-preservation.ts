import {
  DurableContext,
  withDurableExecution,
  CallbackError,
  InvokeError,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map Error Preservation",
  description:
    "Demonstrates that errors thrown in map operations preserve their original type and message",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const items = [
      { id: 1, shouldFail: false },
      { id: 2, shouldFail: true, errorType: "CallbackError" },
      { id: 3, shouldFail: false },
    ];

    const results = await context.map(
      "map-with-errors",
      items,
      async (childContext, item, index) => {
        return await childContext.step(
          `process-item-${index}`,
          async () => {
            if (item.shouldFail) {
              if (item.errorType === "CallbackError") {
                throw new CallbackError(
                  `Custom callback error for item ${item.id}`,
                );
              }
            }
            return `Processed item ${item.id}`;
          },
          { retryStrategy: () => ({ shouldRetry: false }) },
        );
      },
    );

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
      totalSuccess: results.successCount,
    };
  },
);
