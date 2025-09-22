import {DurableContext, withDurableFunctions} from "aws-durable-execution-sdk-js";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    const promise1 = context.step(async () => "success");
    const promise2 = context.step(async () => {
        throw new Error("failure");
    });
    const promise3 = context.step(async () => "another success");
    
    const results = await context.promise.allSettled([promise1, promise2, promise3]);
    
    return results;
});
