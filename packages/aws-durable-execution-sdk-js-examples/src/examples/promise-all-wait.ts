import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Promise All With Wait",
  description: "Waiting for all wait state promises to complete",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const promise1 = context.wait("wait-1", 1);
    const promise2 = context.wait("wait-2", 2);
    const promise3 = context.step(
      "wait-3",
      () => new Promise((resolve) => setTimeout(resolve, 3000)),
    );

    const results = await context.promise.all([promise1, promise2, promise3]);

    return results;
  },
);
