import {
  CallbackError,
  CallbackSubmitterError,
  CallbackTimeoutError,
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Error Instance",
  description:
    "Verifies waitForCallback errors throw correct instances (failure, timeout, submitter)",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const errors: Array<Error | null> = [];

    // Test 1: Callback failure
    try {
      await context.waitForCallback(
        "failure-test",
        async () => {
          return Promise.resolve();
        },
        {
          timeout: { seconds: 10 },
        },
      );
    } catch (error) {
      errors.push(error as Error);
    }

    // Test 2: Callback timeout
    try {
      await context.waitForCallback(
        "timeout-test",
        async () => {
          return Promise.resolve();
        },
        {
          timeout: { seconds: 1 },
        },
      );
    } catch (error) {
      errors.push(error as Error);
    }

    // Test 3: Submitter failure
    try {
      await context.waitForCallback("submitter-test", async () => {
        throw new Error("Submitter failed");
      });
    } catch (error) {
      errors.push(error as Error);
    }

    await context.wait({ seconds: 1 });

    const errorTypes = await context.step("check-error-types", async () => {
      return {
        failureError: {
          isCallbackError: errors[0] instanceof CallbackError,
          errorName: errors[0]?.constructor.name,
          errorMessage: errors[0]?.message,
        },
        timeoutError: {
          isCallbackTimeoutError: errors[1] instanceof CallbackTimeoutError,
          errorName: errors[1]?.constructor.name,
          errorMessage: errors[1]?.message,
        },
        submitterError: {
          isCallbackSubmitterError: errors[2] instanceof CallbackSubmitterError,
          errorName: errors[2]?.constructor.name,
          errorMessage: errors[2]?.message,
        },
      };
    });

    return errorTypes;
  },
);
