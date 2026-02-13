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

export const handlerFailure = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    let error: Error | null = null;

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
    } catch (e) {
      error = e as Error;
    }

    await context.wait({ seconds: 1 });

    return await context.step("check-error-type", async () => ({
      failureError: {
        isCallbackError: error instanceof CallbackError,
        errorName: error?.constructor.name,
        errorMessage: error?.message,
      },
    }));
  },
);

export const handlerTimeout = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    let error: Error | null = null;

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
    } catch (e) {
      error = e as Error;
    }

    await context.wait({ seconds: 1 });

    return await context.step("check-error-type", async () => ({
      timeoutError: {
        isCallbackTimeoutError: error instanceof CallbackTimeoutError,
        errorName: error?.constructor.name,
        errorMessage: error?.message,
      },
    }));
  },
);

export const handlerSubmitter = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    let error: Error | null = null;

    try {
      await context.waitForCallback("submitter-test", async () => {
        throw new Error("Submitter failed");
      });
    } catch (e) {
      error = e as Error;
    }

    await context.wait({ seconds: 1 });

    return await context.step("check-error-type", async () => ({
      submitterError: {
        isCallbackSubmitterError: error instanceof CallbackSubmitterError,
        errorName: error?.constructor.name,
        errorMessage: error?.message,
      },
    }));
  },
);

// Default export for backward compatibility
export const handler = handlerFailure;
