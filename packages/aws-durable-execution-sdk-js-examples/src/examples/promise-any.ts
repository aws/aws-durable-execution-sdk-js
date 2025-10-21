import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Promise Any",
  description: "Waiting for the first successful promise",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const promise1 = context.step(async () => {
      throw new Error("failure 1");
    });
    const promise2 = context.step(async () => "first success");
    const promise3 = context.step(async () => "second success");

    const result = await context.promise.any([promise1, promise2, promise3]);

    return result;
  },
);
