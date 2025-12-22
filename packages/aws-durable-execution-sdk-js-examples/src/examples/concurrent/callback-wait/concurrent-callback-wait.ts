import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Concurrent Callback Wait",
  description:
    "Demonstrates context.promise.all being used with context.wait and a callback promise",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback("callback");

    const beforeWait = await context.step(async () => Date.now());
    await context.promise.all<any>([
      context.wait("wait", { seconds: 1 }),
      callbackPromise,
    ]);
    const afterWait = await context.step(async () => Date.now());

    return afterWait - beforeWait;
  },
);
