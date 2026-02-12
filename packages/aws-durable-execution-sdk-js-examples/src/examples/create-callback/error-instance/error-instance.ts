import {
  CallbackError,
  CallbackTimeoutError,
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Create Callback - Error Instance",
  description:
    "Verifies callback errors throw correct error instances (timeout, failure)",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const errors: Array<Error | null> = [];

    // Test 1: Callback timeout
    try {
      const [callbackPromise] = await context.createCallback("timeout-test", {
        timeout: { seconds: 1 },
      });
      await callbackPromise;
    } catch (error) {
      errors.push(error as Error);
    }

    // Test 2: Callback failure
    try {
      const [callbackPromise] = await context.createCallback("failure-test", {
        timeout: { seconds: 10 },
      });
      await callbackPromise;
    } catch (error) {
      errors.push(error as Error);
    }

    await context.wait({ seconds: 1 });

    const errorTypes = await context.step("check-error-types", async () => {
      return {
        timeoutError: {
          isCallbackTimeoutError: errors[0] instanceof CallbackTimeoutError,
          errorName: errors[0]?.constructor.name,
          errorMessage: errors[0]?.message,
        },
        failureError: {
          isCallbackError: errors[1] instanceof CallbackError,
          errorName: errors[1]?.constructor.name,
          errorMessage: errors[1]?.message,
        },
      };
    });

    return errorTypes;
  },
);
