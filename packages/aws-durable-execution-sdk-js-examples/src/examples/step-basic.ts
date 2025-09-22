import {DurableContext, withDurableFunctions} from "aws-durable-execution-sdk-js";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    const result = await context.step(async () => {
        return "step completed";
    });
    return result;
});
