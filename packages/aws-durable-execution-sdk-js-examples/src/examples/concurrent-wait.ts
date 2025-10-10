import {
  DurableContext,
  withDurableFunctions,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableFunctions(
  async (event: any, context: DurableContext) => {
    console.log("Before waits");
    await Promise.all([
      context.wait("wait-1-second", 1),
      context.wait("wait-2-seconds", 2),
    ]);
    console.log("After waits");
    return "Completed waits";
  },
);
