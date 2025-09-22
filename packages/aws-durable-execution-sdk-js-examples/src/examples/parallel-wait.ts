import {
  DurableContext,
  withDurableFunctions,
} from "aws-durable-execution-sdk-js";

export const handler = withDurableFunctions(
  async (event: any, context: DurableContext) => {
    console.log("Before waits");
    await context.parallel("parent-block", [
        async (childContext: DurableContext) => await childContext.wait("wait-1-second", 1000),
        async (childContext: DurableContext) => await childContext.wait("wait-2-seconds", 2000),
        async (childContext: DurableContext) => await childContext.wait("wait-5-seconds", 5000),
    ]);
    console.log("After waits");
    return "Completed waits";
  }
);
