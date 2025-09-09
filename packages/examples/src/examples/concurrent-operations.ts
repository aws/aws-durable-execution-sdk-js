import {DurableContext, withDurableFunctions} from "@amzn/durable-executions-language-sdk";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    // Start multiple concurrent operations using runInChildContext
    const task1 = context.runInChildContext("block-1", async (childContext: DurableContext) => {
        const result = await childContext.step("step-1", async () => "task 1 result");
        await childContext.wait("wait-1",1000);
        return result;
    });
    
    const task2 = context.runInChildContext("block-2", async (childContext: DurableContext) => {
        const result = await childContext.step("step-2", async () => "task 2 result");
        await childContext.wait("wait-2", 2000);
        return result;
    });
    
    // Wait for both to complete
    const results = await context.promise.all([task1, task2]);
    
    return results;
});
