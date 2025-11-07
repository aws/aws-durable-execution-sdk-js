import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Create Callback - Failures",
  description:
    "Demonstrates callback failure scenarios where the error propagates and is handled by framework",
};

export const handler = withDurableExecution(
  async (event: { shouldCatchError?: boolean }, context: DurableContext) => {
    if (event.shouldCatchError) {
      // Pattern where error is caught and returned in result
      try {
        const [callbackPromise] = await context.createCallback(
          "failing-operation",
          {
            timeout: { seconds: 60 },
          },
        );

        await callbackPromise;
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      // Pattern where error propagates to framework (for basic failure case)
      const [callbackPromise] =
        await context.createCallback("failing-operation");

      await callbackPromise;
      return { success: true };
    }
  },
);
