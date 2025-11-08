import {
  DurableContext,
  StepError,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Promise All Settled with Error",
  description: "Waiting for all promises to settle with failures",
};

export const handler = withDurableExecution(
  async (_event, context: DurableContext) => {
    const error = Promise.reject(new StepError("My step error"));

    const results = await context.promise.allSettled([error]);

    console.log("results", results[0]);

    const errorIsStepError = await context.step(
      async () =>
        results[0].status === "rejected" &&
        results[0].reason instanceof StepError,
    );

    await context.wait({ seconds: 1 });

    const errorIsStepError2 = await context.step(
      async () =>
        results[0].status === "rejected" &&
        results[0].reason instanceof StepError,
    );

    // this should be true, but it's false
    return errorIsStepError === errorIsStepError2;
  },
);
