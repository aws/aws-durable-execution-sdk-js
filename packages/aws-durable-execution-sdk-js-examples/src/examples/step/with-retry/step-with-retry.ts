import {
  DurableContext,
  withDurableExecution,
  StepSemantics,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Step with Retry",
  description: "Advanced step configuration with retry strategy and semantics",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(
      async () => {
        if (Math.random() < 0.5) {
          throw new Error("Random failure");
        }
        return "step succeeded";
      },
      {
        retryStrategy: (error: Error, attemptCount: number) => {
          if (attemptCount >= 3) {
            return { shouldRetry: false };
          }
          return { shouldRetry: true, delaySeconds: attemptCount };
        },
        semantics: StepSemantics.AtMostOncePerRetry,
      },
    );
    return result;
  },
);
