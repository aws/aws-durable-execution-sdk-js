import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Anonymous Submitter",
  description:
    "Demonstrates waitForCallback with anonymous (inline) submitter function",
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    const result = await context.waitForCallback<{ data: string }>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return Promise.resolve();
    });

    return {
      callbackResult: result,
      completed: true,
    };
  },
);
