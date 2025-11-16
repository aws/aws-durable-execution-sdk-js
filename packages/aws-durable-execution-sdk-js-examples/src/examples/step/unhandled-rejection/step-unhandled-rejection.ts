import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Step Unhandled Rejection",
  description:
    "Test that the durable execution framework will throw unhandled rejection errors when context.step errors are not properly handled",
};

export const handler = withDurableExecution(
  async (_event, context: DurableContext) => {
    context
      .step(
        "failing-step-1",
        async () => {
          throw new Error("Intentional error for unhandled rejection test");
        },
        {
          retryStrategy: () => ({
            shouldRetry: false,
          }),
        },
      )
      // Start promise, but don't attach a catch handler
      .then(() => {});

    // Create delayed promise to trigger unhandled rejection
    await new Promise((resolve) => setTimeout(resolve, 1000));
  },
);
