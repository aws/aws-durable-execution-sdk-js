import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Promise Race",
  description: "Racing promises to completion",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const promise1 = context.step(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return "slow result";
    });
    const promise2 = context.step(async () => "fast result");
    const promise3 = context.step(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return "slower result";
    });

    const result = await context.promise.race("promise-race", [
      promise1,
      promise2,
      promise3,
    ]);

    return result;
  },
);
