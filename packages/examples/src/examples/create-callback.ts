import {DurableContext, withDurableFunctions} from "@amzn/durable-executions-language-sdk";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    const [callbackPromise, callbackId] = await context.createCallback<string>();
    
    console.log(`Created callback with ID: ${callbackId}`);
    
    // In a real scenario, you would send the callbackId to an external system
    // For this example, we'll just log it
    console.log("Send this callbackId to external system:", callbackId);
    
    // The promise would be resolved by calling SendDurableExecutionCallbackSuccess
    // with the callbackId from an external system
    return await callbackPromise;
});
