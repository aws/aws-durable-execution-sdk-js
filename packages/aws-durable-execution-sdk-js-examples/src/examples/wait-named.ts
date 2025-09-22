import {DurableContext, withDurableFunctions} from "aws-durable-execution-sdk-js";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    console.log("Starting wait operation");
    await context.wait("wait-5-seconds", 5000);
    console.log("Wait completed");
    return "wait finished";
});
