import {
    DurableContext,
    withDurableFunctions,
} from "aws-durable-execution-sdk-js";

export const handler = withDurableFunctions(
    async (event: any, context: DurableContext) => {
        console.log("Before waits");
        await Promise.all([
            context.wait("wait-1-second", 1000),
            context.wait("wait-5-seconds", 5000),
            context.wait("wait-10-seconds",10000),
        ])
        console.log("After waits");
        return "Completed waits";
    }
);
