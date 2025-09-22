import {DurableContext, withDurableFunctions, StepSemantics} from "aws-durable-execution-sdk-js";

export const handler = withDurableFunctions(async (event: any, context: DurableContext) => {
    const result = await context.step(async () => {
        if (Math.random() < 0.5) {
            throw new Error("Random failure");
        }
        return "step succeeded";
    }, {
        retryStrategy: (error: Error, attemptCount: number) => {
            if (attemptCount >= 3) {
                return { shouldRetry: false };
            }
            return { shouldRetry: true, delaySeconds: attemptCount };
        },
        semantics: StepSemantics.AtMostOncePerRetry
    });
    return result;
});
