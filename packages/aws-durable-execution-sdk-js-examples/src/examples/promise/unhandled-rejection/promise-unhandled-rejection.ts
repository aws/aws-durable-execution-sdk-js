import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Promise Unhandled Rejection",
  description: "Test that promise combinators don't cause unhandled rejections",
};

export const handler = withDurableExecution(
  async (_event, context: DurableContext) => {
    const failurePromise = context.step(
      "failure-step",
      async () => {
        throw new Error("This step failed");
      },
      {
        retryStrategy: () => ({
          shouldRetry: false,
        }),
      },
    );

    try {
      await context.promise.all([failurePromise]);
    } catch {
      // ignoring error should not fail execution
    }
    await context.wait(1);

    const successStep = await context.step(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return "Success";
    });

    return {
      successStep,
    };
  },
);
