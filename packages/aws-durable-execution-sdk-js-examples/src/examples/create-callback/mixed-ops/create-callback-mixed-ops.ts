import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Create Callback - Mixed Operations",
  description:
    "Demonstrates createCallback mixed with steps, waits, and other operations",
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    const stepResult = await context.step("fetch-data", () => {
      return Promise.resolve({ userId: 123, name: "John Doe" });
    });

    const [callbackPromise] = await context.createCallback("process-user", {
      timeout: { minutes: 5 },
    });

    // Mix callback with step and wait operations
    await context.wait("initial-wait", { seconds: 1 });

    const callbackResult = await callbackPromise;

    return {
      stepResult,
      callbackResult,
      completed: true,
    };
  },
);
