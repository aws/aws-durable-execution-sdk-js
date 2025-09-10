import {DurableContext, withDurableFunctions} from "aws-durable-functions-sdk-js";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    const result = await context.step("process-data", async () => {
        return `processed: ${event.data || "default"}`;
    });
    return result;
});
