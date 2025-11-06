import {
  ChildContextError,
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Run in Child Context with Failing Step",
  description:
    "Demonstrates runInChildContext with a failing step followed by a successful wait",
};

export const handler = withDurableExecution(
  async (_event, context: DurableContext) => {
    try {
      await context.runInChildContext("child-with-failure", async (ctx) => {
        await ctx.step(
          "failing-step",
          async () => {
            throw new Error("Step failed in child context");
          },
          {
            retryStrategy: (_, attemptCount) => {
              return {
                shouldRetry: attemptCount < 3,
                delaySeconds: 1 * attemptCount,
              };
            },
          },
        );
      });
    } catch (error) {
      if (!(error instanceof ChildContextError)) {
        throw error;
      }
    }

    await context.wait("wait-after-failure", { seconds: 1 });

    return { success: true };
  },
);
