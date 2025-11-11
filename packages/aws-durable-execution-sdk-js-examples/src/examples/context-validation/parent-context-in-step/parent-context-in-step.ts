import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Parent Context in Step Error",
  description:
    "Demonstrates error when using parent context inside a step function within runInChildContext",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    console.log("Starting parent context operations");

    // This will fail because we're using the parent context inside a step within the child
    const result = await context.runInChildContext(
      "child-context",
      async (childContext: DurableContext) => {
        console.log("Inside child context");

        // This step should work fine
        const step1 = await childContext.step("correct-step", async () => {
          return "This should work!";
        });

        // ❌ WRONG: Using parent context inside a step function
        // This should throw: "Context usage error in 'step': You are using a parent or sibling context..."
        const stepWithInvalidNested = await childContext.step(
          "step-with-invalid-nested",
          async () => {
            // Using parent context inside step function - this should fail
            // eslint-disable-next-line aws-durable-execution-eslint/no-nested-durable-operations
            await context.step("invalid-nested-step", async () => {
              return "This should fail!";
            });
            return "Should not reach here";
          },
        );

        return { step1, stepWithInvalidNested };
      },
    );

    // This should never be reached due to validation error
    await context.wait("should-not-start", { seconds: 1 });

    return result;
  },
);
