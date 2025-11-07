import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Create Callback - Concurrent",
  description:
    "Demonstrates multiple concurrent createCallback operations using Promise.all",
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    // Start multiple callbacks concurrently
    const [promise1] = await context.createCallback("api-call-1", {
      timeout: { minutes: 5 },
    });
    const [promise2] = await context.createCallback("api-call-2", {
      timeout: { minutes: 5 },
    });
    const [promise3] = await context.createCallback("api-call-3", {
      timeout: { minutes: 5 },
    });

    const [result1, result2, result3] = await Promise.all([
      promise1,
      promise2,
      promise3,
    ]);

    return {
      results: [result1, result2, result3],
      allCompleted: true,
    };
  },
);
