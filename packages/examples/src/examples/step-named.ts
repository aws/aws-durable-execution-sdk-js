import {DurableContext, withDurableFunctions} from "@amzn/durable-executions-language-sdk";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    const result = await context.step("process-data", async () => {
        return `processed: ${event.data || "default"}`;
    });
    return result;
});
