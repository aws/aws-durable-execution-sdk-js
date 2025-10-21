import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Run in Child Context",
  description: "Basic usage of context.runInChildContext()",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      async (childContext: DurableContext) => {
        const stepResult = await childContext.step(async () => {
          return "child step completed";
        });
        return stepResult;
      },
    );
    return result;
  },
);
