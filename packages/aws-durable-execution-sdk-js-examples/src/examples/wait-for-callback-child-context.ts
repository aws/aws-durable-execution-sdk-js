import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Child Context",
  description: "Demonstrates waitForCallback operations within child contexts",
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    const parentResult = await context.waitForCallback<{
      parentData: string;
    }>("parent-callback-op", async () => {
      return Promise.resolve();
    });

    const childContextResult = await context.runInChildContext(
      "child-context-with-callback",
      async (childContext) => {
        await childContext.wait("child-wait", 1);

        const childCallbackResult = await childContext.waitForCallback<{
          childData: number;
        }>("child-callback-op", async () => {
          return Promise.resolve();
        });

        return {
          childResult: childCallbackResult,
          childProcessed: true,
        };
      },
    );

    return {
      parentResult,
      childContextResult,
    };
  },
);
