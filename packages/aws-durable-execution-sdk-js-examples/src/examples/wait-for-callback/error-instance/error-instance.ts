import {
  CallbackTimeoutError,
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Error Instance",
  description:
    "Verifies waitForCallback timeout throws CallbackTimeoutError instance",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    let caughtError: Error | null = null;

    try {
      await context.waitForCallback(
        async () => {
          // Submitter succeeds but callback never completes
          return Promise.resolve();
        },
        {
          timeout: { seconds: 1 },
        },
      );
    } catch (error) {
      caughtError = error as Error;
    }

    await context.wait({ seconds: 1 });

    const errorType = await context.step("check-error-type", async () => {
      return {
        isCallbackTimeoutError: caughtError instanceof CallbackTimeoutError,
        errorName: caughtError?.constructor.name,
        errorMessage: caughtError?.message,
      };
    });

    return errorType;
  },
);
