import {
  DurableContext,
  withDurableFunctions,
} from "@amzn/durable-executions-language-sdk";

export const handler = withDurableFunctions(
  async (event: any, context: DurableContext) => {
    console.log("Before waits");
    await context.runInChildContext((childContext) =>
      Promise.all([
        childContext.wait(1000),
        childContext.wait(5000),
        childContext.wait(10000),
      ])
    );
    console.log("After waits");
    return "Completed waits";
  }
);
