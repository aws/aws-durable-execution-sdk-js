import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Nested Contexts",
  description:
    "Demonstrates nested waitForCallback operations across multiple child context levels",
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    const outerResult = await context.waitForCallback(
      "outer-callback-op",
      async () => {
        return Promise.resolve();
      },
    );

    const nestedResult = await context.runInChildContext(
      "outer-child-context",
      async (outerChildContext) => {
        const innerResult = await outerChildContext.waitForCallback(
          "inner-callback-op",
          async () => {
            return Promise.resolve();
          },
        );

        // Nested child context with another callback
        const deepNestedResult = await outerChildContext.runInChildContext(
          "inner-child-context",
          async (innerChildContext) => {
            await innerChildContext.wait("deep-wait", { seconds: 5 });

            const nestedCallbackResult =
              await innerChildContext.waitForCallback(
                "nested-callback-op",
                async () => {
                  return Promise.resolve();
                },
              );

            return {
              nestedCallback: nestedCallbackResult,
              deepLevel: "inner-child",
            };
          },
        );

        return {
          innerCallback: innerResult,
          deepNested: deepNestedResult,
          level: "outer-child",
        };
      },
    );

    return {
      outerCallback: outerResult,
      nestedResults: nestedResult,
    };
  },
);
