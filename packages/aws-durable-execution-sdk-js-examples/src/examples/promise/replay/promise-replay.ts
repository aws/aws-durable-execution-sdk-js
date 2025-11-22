import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Promise Replay",
  description:
    "Replaying failed promise operations. There should be no unhandled rejections.",
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

    await context.promise.allSettled([failurePromise]);
    await context.wait({ seconds: 1 });

    const successStep = await context.step(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return "Success";
    });

    return {
      successStep,
    };
  },
);
