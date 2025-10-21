import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Block Example",
  description: "Advanced child context example",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    console.log("Handler started");

    // Example of using runInChildContext with a child context
    const result = await context.runInChildContext(
      "parent_block",
      async (childContext: DurableContext) => {
        console.log("Inside parent block");

        // Use the child context for nested operations
        const nestedResult = await childContext.step(
          "nested_step",
          async () => {
            console.log("Inside nested step");
            return "nested step result";
          },
        );

        // Nested block with its own child context
        const nestedBlockResult = await childContext.runInChildContext(
          "nested_block",
          async (grandchildContext: DurableContext) => {
            console.log("Inside nested block");

            // Use the grandchild context for further nested operations
            await grandchildContext.wait(1);

            return "nested block result";
          },
        );

        return {
          nestedStep: nestedResult,
          nestedBlock: nestedBlockResult,
        };
      },
    );

    console.log("Block completed with result:", result);
    return result;
  },
);
