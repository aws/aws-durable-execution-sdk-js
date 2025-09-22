import {DurableContext, withDurableFunctions} from "aws-durable-execution-sdk-js";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    const promise1 = context.step(async () => "result 1");
    const promise2 = context.step(async () => "result 2");
    const promise3 = context.step(async () => "result 3");
    
    const results = await context.promise.all([promise1, promise2, promise3]);
    
    return results;
});
