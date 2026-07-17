import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Resolves During Submitter",
  description:
    "Demonstrates waitForCallback where the callback is externally resolved " +
    "while the submitter function is still running. This exercises a race in " +
    "TimerScheduler where hasScheduledFunction() must remain true while " +
    "in-flight work is pending (see #544).",
  localOnly: true,
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    // The submitter does async work that takes longer than the time needed
    // for the external callback resolution to be processed. Without the fix,
    // the callback-completion timer fires, immediately deletes itself from
    // runningTimers, removes the callback from pendingOperations, and the
    // reinvocation is skipped (active invocation). When the submitter
    // finishes and the handler returns PENDING, hasScheduledFunction()
    // falsely returns false -> spurious "Cannot return PENDING status" error.
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
