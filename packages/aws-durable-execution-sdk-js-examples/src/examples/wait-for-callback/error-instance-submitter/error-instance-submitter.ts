import {
  CallbackSubmitterError,
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Error Instance Submitter",
  description:
    "Verifies CallbackSubmitterError instanceof check works across replays",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    let error: Error | null = null;

    try {
      await context.waitForCallback(
        "submitter-test",
        async () => {
          throw new Error("Submitter failed");
        },
        {
          retryStrategy: () => ({ shouldRetry: false }),
        },
      );
    } catch (e) {
      error = e as Error;
    }

    return await context.step("check-error-type", async () => ({
      isCallbackSubmitterError: error instanceof CallbackSubmitterError,
      errorName: error?.constructor.name,
      errorMessage: error?.message,
    }));
  },
);
