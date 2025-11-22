import {
  DurableContext,
  withDurableExecution,
  DurablePromise,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Promise All",
  description: "Waiting for all promises to complete",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const step1 = context.step(async () => "result 1");
    const step2 = context.step(async () => "result 2");
    const step3 = context.step(async () => "result 3");

    const promise1 = new DurablePromise(() => step1);
    const promise2 = new DurablePromise(() => step2);
    const promise3 = new DurablePromise(() => step3);

    const results = await context.promise.all([promise1, promise2, promise3]);

    return results;
  },
);
