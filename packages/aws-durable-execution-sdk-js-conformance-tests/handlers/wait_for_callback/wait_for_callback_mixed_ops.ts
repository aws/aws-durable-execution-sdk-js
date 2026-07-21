// 7-10: Wait-for-callback mixed with wait and step
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // 1-second durable wait
    await context.wait({ seconds: 1 });

    // Top-level step returning fixed data
    await context.step(async () => {
      return "fixed-data";
    });

    // Wait-for-callback using event as operation name
    const result = await context.waitForCallback(event, async (callbackId) => {
      // Submitter completes.
    });

    return result;
  },
);
