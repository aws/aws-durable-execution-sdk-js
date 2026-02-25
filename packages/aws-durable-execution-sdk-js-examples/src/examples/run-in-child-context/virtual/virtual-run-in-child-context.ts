import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Run in Virtual Child Context",
  description:
    "Usage of context.runInChildContext() with virtualContext option for cost optimization",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      async (childContext: DurableContext) => {
        const stepResult = await childContext.step(async () => {
          return "virtual child step completed";
        });
        return stepResult;
      },
      { virtualContext: true }, // Skip checkpointing to save operation costs
    );
    return result;
  },
);
