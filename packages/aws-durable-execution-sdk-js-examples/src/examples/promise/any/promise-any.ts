import {
  DurableContext,
  StepConfig,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Promise Any",
  description: "Waiting for the first successful promise",
};

const stepConfig: StepConfig<any> = {
  retryStrategy: (_error, attemptCount) => {
    return {
      shouldRetry: attemptCount < 3,
      delay: { seconds: 1 },
    };
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const promise1 = context.step(async () => {
      throw new Error("failure 1");
    }, stepConfig);
    const promise2 = context.step(async () => {
      if (event.shouldFail) {
        throw new Error("ERROR 1");
      }
      return "first success";
    }, stepConfig);
    const promise3 = context.step(async () => {
      if (event.shouldFail) {
        throw new Error("ERROR 2");
      }
      return "second success";
    }, stepConfig);

    const result = await context.promise.any([promise1, promise2, promise3]);

    return result;
  },
);
