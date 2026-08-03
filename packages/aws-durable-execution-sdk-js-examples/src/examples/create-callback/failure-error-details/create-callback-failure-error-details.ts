import {
  CallbackError,
  CallbackExternalError,
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Create Callback - Failure Error Details",
  description:
    "Shows how the rich error details an external system reports when failing a callback " +
    "(error type, machine-readable error data, and a stack trace) are reconstructed on the " +
    "thrown CallbackExternalError so the durable function can inspect and act on them.",
};

/**
 * Creates a callback for an external system (here, a payment processor) and, when the
 * external system reports a failure, surfaces the reconstructed error so callers can see
 * exactly what the external system sent:
 *
 * - `errorType` / `message` come from the {@link CallbackExternalError} itself.
 * - `errorData` is the machine-readable payload the external system attached.
 * - `cause` is a plain Error reconstructed from the external `ErrorType` (its `name`),
 *   `ErrorMessage` (its `message`), and `StackTrace` (its `stack`).
 */
export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    try {
      const [callbackPromise, callbackId] = await context.createCallback(
        "charge-payment",
        {
          timeout: { minutes: 5 },
        },
      );

      // Hand the callback id to the external payment processor. Doing this as a
      // durable step keeps the callback un-awaited while the request is
      // dispatched, so a fast external response is applied to the same
      // invocation that later awaits it.
      await context.step("dispatch-to-processor", async () => {
        return { dispatched: true, callbackId };
      });

      await callbackPromise;

      return { settled: true };
    } catch (error) {
      if (!(error instanceof CallbackExternalError)) {
        throw error;
      }

      const cause = error.cause;
      return {
        settled: false,
        errorType: error.errorType,
        message: error.message,
        errorData: error.errorData,
        isCallbackError: error instanceof CallbackError,
        isExternalError: error instanceof CallbackExternalError,
        cause: {
          name: cause?.name,
          message: cause?.message,
          stack: cause?.stack,
        },
      };
    }
  },
);
