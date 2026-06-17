import {
  CallbackError,
  ChildContextError,
  DurableContext,
  DurableOperationError,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Run in Child Context - Error Data Propagation",
  description:
    "Demonstrates that errorData is preserved when errors cross multiple runInChildContext boundaries (issue #524)",
};

const SENTINEL = JSON.stringify({ reason: "operator-cancelled" });

export const handler = withDurableExecution(
  async (_event, context: DurableContext) => {
    try {
      await context.runInChildContext(
        "outer-child",
        async (outerChild: DurableContext) => {
          await outerChild.runInChildContext(
            "inner-child",
            async (innerChild: DurableContext) => {
              await innerChild.step("throw-with-error-data", async () => {
                throw new CallbackError("cb failed", undefined, SENTINEL);
              });
            },
          );
        },
      );
    } catch (error) {
      // Walk the cause chain to find errorData
      let node: unknown = error;
      for (let i = 0; i < 10 && node; i++) {
        if (
          node instanceof DurableOperationError &&
          typeof node.errorData === "string"
        ) {
          return { found: true, errorData: node.errorData };
        }
        node = (node as any).cause;
      }
      return { found: false, errorData: undefined };
    }

    return { found: false, errorData: undefined };
  },
);
