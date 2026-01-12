import {
  withDurableExecution,
  DurableContext,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Concurrent Callback with Submitter",
  description:
    "Demonstrates waitForCallback with submitter function inside context.parallel",
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    const parallelResult = await context.parallel([
      (childContext) =>
        childContext.waitForCallback<string>(
          "wait-for-callback-1",
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            return Promise.resolve();
          },
        ),
      (childContext) =>
        childContext.waitForCallback<string>(
          "wait-for-callback-2",
          async () => {
            return Promise.resolve();
          },
        ),
    ]);

    const [result1, result2] = parallelResult
      .getResults()
      .map((result) => JSON.parse(result));

    return {
      results: [result1, result2],
      allCompleted: true,
    };
  },
);
