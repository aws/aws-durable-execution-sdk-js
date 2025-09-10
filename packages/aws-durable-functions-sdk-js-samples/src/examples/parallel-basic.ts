import {DurableContext, withDurableFunctions} from "aws-durable-functions-sdk-js";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    const results = await context.parallel("parallel", [
        async (context: DurableContext) => {
            return await context.step(async () => {
                return "task 1 completed";
            });
        },
        async (context: DurableContext) => {
            return await context.step(async () => {
                return "task 2 completed";
            });
        },
        async (context: DurableContext) => {
            await context.wait(1000);
            return "task 3 completed after wait";
        }
    ], {
        maxConcurrency: 2
    });
    
    return results.getResults();
});
