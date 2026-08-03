import {
  CallbackError,
  CallbackTimeoutError,
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Create Callback - Timeout Classification",
  description:
    "Shows that when a callback times out (rather than being failed by an external system), " +
    "the awaited promise rejects with a CallbackTimeoutError — a CallbackError subclass — so " +
    "callers can distinguish a timeout from an explicit external failure.",
};

/**
 * Creates a callback that must be answered within a short deadline. The function
 * keeps doing other work while the external approver is expected to respond;
 * that work outlasts the deadline, so by the time the callback is awaited it has
 * already timed out and the SDK surfaces a {@link CallbackTimeoutError}.
 */
export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback(
      "await-external-approval",
      {
        timeout: { seconds: 1 },
      },
    );

    // Other in-invocation work that outlasts the callback deadline. Because the
    // callback is not awaited yet, the timeout fires during this work and is
    // applied to the same invocation that later awaits the callback.
    await context.step("reconcile-local-state", async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return { reconciled: true };
    });

    try {
      await callbackPromise;
      return { approved: true };
    } catch (error) {
      if (!(error instanceof CallbackTimeoutError)) {
        throw error;
      }

      return {
        approved: false,
        timedOut: true,
        // A timeout is still a CallbackError, so a single `instanceof
        // CallbackError` catch handles both timeouts and external failures.
        isCallbackError: error instanceof CallbackError,
        isTimeoutError: error instanceof CallbackTimeoutError,
        errorType: error.errorType,
        message: error.message,
      };
    }
  },
);
