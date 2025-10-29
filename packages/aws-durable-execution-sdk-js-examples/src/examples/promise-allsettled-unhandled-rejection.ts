import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Promise AllSettled Unhandled Rejection",
  description:
    "Reproduces bug where failed step in allSettled causes unhandled rejection on replay",
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const failurePromise = context.step(
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
    await context.wait(1);

    const successStep = await context.step(async () => {
      return "Success";
    });

    return {
      successStep,
    };
  },
);
