import {DurableContext, withDurableFunctions} from "@amzn/durable-executions-language-sdk";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    const result = await context.waitForCallback<string>(
        async (callbackId: string) => {
            console.log(`Submitting work with callback ID: ${callbackId}`);
            // In a real scenario, you would send the callbackId to an external system
            // like SQS, SNS, or an HTTP API
        },
        {
            timeout: 300, // 5 minutes
            heartbeatTimeout: 60 // 1 minute
        }
    );
    
    return result;
});
