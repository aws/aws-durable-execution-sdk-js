import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Promise All Settled",
  description: "Waiting for all promises to settle (success or failure)",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const promise1 = context.step(async () => "success");
    const promise2 = context.step(async () => {
      throw new Error("failure");
    });
    const promise3 = context.step(async () => "another success");

    const results = await context.promise.allSettled([
      promise1,
      promise2,
      promise3,
    ]);

    return results;
  },
);
