import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Parallel minSuccessful with Callbacks",
  description:
    "Parallel execution with minSuccessful:1 where branches use callbacks",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const results = await context.parallel(
      "parallel-callbacks",
      [
        async (childContext) => {
          const [callbackPromise, callbackId] =
            await childContext.createCallback<string>("branch-1-callback");
          log(`Branch 1 callback ID: ${callbackId}`);
          return await callbackPromise;
        },
        async (childContext) => {
          const [callbackPromise, callbackId] =
            await childContext.createCallback<string>("branch-2-callback");
          log(`Branch 2 callback ID: ${callbackId}`);

          return await callbackPromise;
        },
        async (childContext) => {
          const [callbackPromise, callbackId] =
            await childContext.createCallback<string>("branch-3-callback");
          log(`Branch 3 callback ID: ${callbackId}`);

          return await callbackPromise;
        },
      ],
      {
        completionConfig: {
          minSuccessful: 1,
        },
      },
    );

    return results.getResults();
  },
);
