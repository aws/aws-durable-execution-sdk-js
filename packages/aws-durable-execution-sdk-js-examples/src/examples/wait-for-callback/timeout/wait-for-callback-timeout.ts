import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Timeout",
  description: "Demonstrates waitForCallback timeout scenarios",
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    try {
      const result = await context.waitForCallback<{ data: string }>(
        async () => {
          // Submitter succeeds but callback never completes
          return Promise.resolve();
        },
        {
          timeout: 1, // 1 second timeout
        },
      );

      return {
        callbackResult: result,
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);
