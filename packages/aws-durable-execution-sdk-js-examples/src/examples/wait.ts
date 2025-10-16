import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    console.log("Hello world before wait!");
    await context.wait(2);
    console.log("Hello world after wait!");
    return "Function Completed";
  },
);
