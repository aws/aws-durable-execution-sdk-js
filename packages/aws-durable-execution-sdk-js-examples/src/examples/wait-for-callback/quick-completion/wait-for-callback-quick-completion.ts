import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Quick Completion",
  description:
    "Demonstrates waitForCallback invocation-level completion scenario",
};

export const handler = withDurableExecution(
  async (event: { submitterDelay: number }, context: DurableContext) => {
    const result = await context.waitForCallback(async () => {
      if (event.submitterDelay) {
        await new Promise((resolve) =>
          setTimeout(resolve, event.submitterDelay * 1000),
        );
      }
      return Promise.resolve();
    });

    return {
      callbackResult: result,
      success: true,
    };
  },
);
