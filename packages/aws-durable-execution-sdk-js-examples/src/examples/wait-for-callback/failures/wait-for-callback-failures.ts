import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Callback Failures",
  description:
    "Demonstrates handling of callback failure scenarios where submitter succeeds but external system fails",
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    try {
      const result = await context.waitForCallback(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // Submitter succeeds - simulates successful external API call setup
        return Promise.resolve();
      });

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
