import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Parent Context in WaitForCondition Error",
  description:
    "Demonstrates error when using parent context inside waitForCondition check function within runInChildContext",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    log("Starting parent context operations");

    const result = await context.runInChildContext(
      "child-context",
      async (childContext: DurableContext) => {
        log("Inside child context");

        // ❌ WRONG: Using parent context inside waitForCondition check function
        const wrongWait = await childContext.waitForCondition(
          "wrong-wait-condition",
          async (currentState: number) => {
            // Using parent context inside check function - this should fail
            // eslint-disable-next-line aws-durable-execution-eslint/no-nested-durable-operations
            await context.step("nested-wrong-step", async () => {
              return "This should fail!";
            });
            return currentState + 1;
          },
          {
            initialState: 0,
            waitStrategy: (state, attempt) =>
              attempt < 3
                ? { shouldContinue: true, delay: { seconds: 1 } }
                : { shouldContinue: false },
          },
        );

        return wrongWait;
      },
    );

    // This should never be reached due to validation error
    await context.wait("should-not-start", { seconds: 1 });

    return result;
  },
);
