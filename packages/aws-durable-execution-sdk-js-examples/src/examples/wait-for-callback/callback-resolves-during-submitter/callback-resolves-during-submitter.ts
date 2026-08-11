import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Resolves During Submitter",
  description:
    "Demonstrates waitForCallback where the callback is externally resolved " +
    "while the submitter function is still running, so the handler observes " +
    "the completed callback in the same invocation it started it.",
  localOnly: true,
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    // The submitter does async work for long enough that an external caller can
    // resolve the callback before it returns. The completion reaches this
    // invocation through the response to the submitter step's own checkpoint,
    // so waitForCallback resolves without the execution suspending.
    const result = await context.waitForCallback(
      "delayed-submitter",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
    );

    return {
      callbackResult: result,
      completed: true,
    };
  },
);
