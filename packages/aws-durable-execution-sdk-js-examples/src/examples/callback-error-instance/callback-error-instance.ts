import {
  CallbackTimeoutError,
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Callback Error Instance",
  description: "Verifies callback timeout throws CallbackTimeoutError instance",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    let caughtError: Error | null = null;

    try {
      const [callbackPromise] = await context.createCallback("timeout-test", {
        timeout: { seconds: 1 },
      });
      await callbackPromise;
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
