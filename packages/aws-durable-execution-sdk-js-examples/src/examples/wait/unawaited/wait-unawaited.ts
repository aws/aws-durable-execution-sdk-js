import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Unawaited Wait",
  description:
    "Demonstrates scheduling a wait operation without awaiting it - function completes immediately while wait is scheduled",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    // Schedule a long wait operation without awaiting it
    // This demonstrates that the function can complete successfully
    // even when wait operations are scheduled but not awaited
    void context.wait({ days: 1 });

    // Give a brief moment to ensure the wait operation is scheduled
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });

    // Function completes immediately, despite the scheduled wait
    return "result";
  },
);
