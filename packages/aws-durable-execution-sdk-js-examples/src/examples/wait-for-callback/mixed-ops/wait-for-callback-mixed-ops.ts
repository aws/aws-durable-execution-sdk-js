import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Mixed Operations",
  description:
    "Demonstrates waitForCallback combined with steps, waits, and other operations",
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    // Mix waitForCallback with other operation types
    await context.wait("initial-wait", { seconds: 1 });

    const stepResult = await context.step("fetch-user-data", () => {
      return Promise.resolve({ userId: 123, name: "John Doe" });
    });

    const callbackResult = await context.waitForCallback<{
      processed: boolean;
    }>("wait-for-callback", async () => {
      // Submitter uses data from previous step
      await new Promise((resolve) => setTimeout(resolve, 100));
      return Promise.resolve();
    });

    await context.wait("final-wait", { seconds: 2 });

    const finalStep = await context.step("finalize-processing", () => {
      return Promise.resolve({
        status: "completed",
        timestamp: Date.now(),
      });
    });

    return {
      stepResult,
      callbackResult,
      finalStep,
      workflowCompleted: true,
    };
  },
);
