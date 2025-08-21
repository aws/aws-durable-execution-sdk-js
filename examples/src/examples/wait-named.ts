import {DurableContext, withDurableFunctions} from "@amzn/durable-executions-language-sdk";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    console.log("Starting wait operation");
    await context.wait(5000, "wait-5-seconds");
    console.log("Wait completed");
    return "wait finished";
});
