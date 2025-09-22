import {DurableContext, withDurableFunctions} from "aws-durable-execution-sdk-js";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    const items = [1, 2, 3, 4, 5];
    
    const results = await context.map(
        "map",
        items,
        async (context: DurableContext, item: number, index: number) => {
            return await context.step(async () => {
                return item * 2;
            });
        },
        {
            maxConcurrency: 2
        }
    );
    
    return results.getResults();
});
