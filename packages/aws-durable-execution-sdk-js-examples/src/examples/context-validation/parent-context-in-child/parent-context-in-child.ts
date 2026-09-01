import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Parent Context in Child Error",
  description:
    "Demonstrates error when using parent context directly inside runInChildContext",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    log("Starting parent context operations");

    // This will fail because we're using the parent context inside the child
    const result = await context.runInChildContext(
      "child-context",
      async (childContext: DurableContext) => {
        log("Inside child context");

        // ❌ WRONG: Using parent context instead of childContext
        // This should throw: "Context usage error in 'step': You are using a parent or sibling context..."
        // eslint-disable-next-line aws-durable-execution-eslint/no-nested-durable-operations
        const wrongStep = await context.step("wrong-step", async () => {
          return "This should fail!";
        });

        return wrongStep;
      },
    );

    return result;
  },
);
