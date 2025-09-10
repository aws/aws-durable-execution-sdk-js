import {DurableContext, withDurableFunctions} from "aws-durable-functions-sdk-js";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    console.log("Hello world from a durable function!");
    return "Hello World!"
});