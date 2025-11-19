import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback Multiple Invocations",
  description:
    "Demonstrates multiple invocations tracking with waitForCallback operations across different invocations",
};

export const handler = withDurableExecution<unknown, unknown>(
  async (_event: unknown, context: DurableContext) => {
    // First invocation - wait operation
    await context.wait("wait-invocation-1", { seconds: 1 });

    // First callback operation
    const callbackResult1 = await context.waitForCallback<{
      step: number;
    }>("first-callback", async (callbackId) => {
      // Simulate submitter function work
      return Promise.resolve();
    });

    // Step operation between callbacks
    const stepResult = await context.step("process-callback-data", () => {
      return Promise.resolve({ processed: true, step: 1 });
    });

    // Second invocation - another wait operation
    await context.wait("wait-invocation-2", { seconds: 1 });

    // Second callback operation
    const callbackResult2 = await context.waitForCallback<{
      step: number;
    }>("second-callback", async (callbackId) => {
      return Promise.resolve();
    });

    // Final invocation returns complete result
    return {
      firstCallback: callbackResult1,
      secondCallback: callbackResult2,
      stepResult,
      invocationCount: "multiple",
    };
  },
);
