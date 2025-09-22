import {DurableContext, withDurableFunctions} from "aws-durable-execution-sdk-js";

const mySubmitterFunction = async (callbackId: string): Promise<void> => {
    console.log(`Calling my external system with callback id: ${callbackId}`);
}

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    console.log("Hello world before callback!");
    await context.waitForCallback("my callback function", mySubmitterFunction, {
        timeout: 10000,
    });
    console.log("Hello world after callback!");
});