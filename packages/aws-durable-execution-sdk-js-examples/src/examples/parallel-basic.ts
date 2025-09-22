import {DurableContext, withDurableFunctions} from "aws-durable-execution-sdk-js";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    const results = await context.parallel("parallel", [
        async (childContext) => {
            return await childContext.step(async () => {
                return "task 1 completed";
            });
        },
        async (childContext) => {
            return await childContext.step(async () => {
                return "task 2 completed";
            });
        },
        async (childContext) => {
            await childContext.wait(1000);
            return "task 3 completed after wait";
        }
    ], {
        maxConcurrency: 2
    });
    
    return results.getResults();
});
