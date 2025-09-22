import {DurableContext, withDurableFunctions} from "aws-durable-execution-sdk-js";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(async (childContext: DurableContext) => {
        const stepResult = await childContext.step(async () => {
            return "child step completed";
        });
        return stepResult;
    });
    return result;
});
