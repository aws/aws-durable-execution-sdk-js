import {
  DurableContext,
  PromiseCombinatorError,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Promise Try-Catch",
  description:
    "Catching PromiseCombinatorError when using context.promise combinators",
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    let result;
    let errorCaught = false;

    try {
      result = await context.promise.all([
        context.step("step-1", async () => "result-1"),
        context.step(
          "step-2",
          async () => {
            throw new Error("Expected failure");
          },
          { retryStrategy: () => ({ shouldRetry: false }) },
        ),
        context.step("step-3", async () => "result-3"),
      ]);
    } catch (error: unknown) {
      if (error instanceof PromiseCombinatorError) {
        errorCaught = true;
        result = `caught PromiseCombinatorError: ${error.message}`;
      } else {
        throw error; // Re-throw if it's not the expected error type
      }
    }

    return {
      result,
      errorCaught,
    };
  },
);
