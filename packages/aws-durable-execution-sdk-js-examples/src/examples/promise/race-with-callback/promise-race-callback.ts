import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Promise Race with Callbacks",
  description:
    "Racing promises using context.promise.race with createCallback - demonstrates first-to-complete behavior similar to parallel with minSuccessful:1",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Create three callbacks - each returns [promise, callbackId]
    const [callback1] = await context.createCallback("callback-1");
    const [callback2] = await context.createCallback("callback-2");
    const [callback3] = await context.createCallback("callback-3");

    // Use context.promise.race to get the first completed callback
    const result = await context.promise.race("race-callbacks", [
      callback1,
      callback2,
      callback3,
    ]);

    return result;
  },
);
