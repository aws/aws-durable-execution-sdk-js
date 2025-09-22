import {DurableContext, withDurableFunctions} from "aws-durable-execution-sdk-js";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    console.log("Hello world before wait!");
    await context.wait(10000);
    console.log("Hello world after wait!");
    return "Function Completed"
});