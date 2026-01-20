import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map High Concurrency Invoke",
  description:
    "Map operation with 200 items and high concurrency (100) where each item invokes a Lambda function",
};

const sleep = async (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const handler = withDurableExecution(
  async (
    event: {
      functionName: string;
    },
    context: DurableContext,
  ) => {
    await sleep(100);

    await context.map(
      "process-objects",
      [...new Array(200)],
      async (ctx) => {
        await sleep(150);
        await ctx.invoke(event.functionName, {
          waitMs: 0,
        });
      },
      {
        maxConcurrency: 100,
      },
    );
  },
);
