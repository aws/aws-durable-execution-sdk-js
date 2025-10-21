import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Parallel wait",
  description: "Start parallel waits with context.parallel",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    console.log("Before waits");
    await context.parallel("parent-block", [
      async (childContext: DurableContext) =>
        await childContext.wait("wait-1-second", 1),
      async (childContext: DurableContext) =>
        await childContext.wait("wait-2-seconds", 2),
      async (childContext: DurableContext) =>
        await childContext.wait("wait-5-seconds", 5),
    ]);
    console.log("After waits");
    return "Completed waits";
  },
);
