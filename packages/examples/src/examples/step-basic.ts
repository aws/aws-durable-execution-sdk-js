import {DurableContext, withDurableFunctions} from "@amzn/durable-executions-language-sdk";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    const result = await context.step(async () => {
        return "step completed";
    });
    return result;
});
