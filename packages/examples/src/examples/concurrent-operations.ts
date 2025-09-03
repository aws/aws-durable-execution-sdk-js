import {DurableContext, withDurableFunctions} from "@amzn/durable-executions-language-sdk";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    // Start multiple concurrent operations using runInChildContext
    const task1 = context.runInChildContext(async (childContext: DurableContext) => {
        const result = await childContext.step(async () => "task 1 result");
        await childContext.wait(1000);
        return result;
    });
    
    const task2 = context.runInChildContext(async (childContext: DurableContext) => {
        const result = await childContext.step(async () => "task 2 result");
        await childContext.wait(2000);
        return result;
    });
    
    // Wait for both to complete
    const results = await context.promise.all([task1, task2]);
    
    return results;
});
