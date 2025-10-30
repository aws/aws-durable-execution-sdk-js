import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait State",
  description: "Basic usage of context.wait() to pause execution",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    console.log("Hello world before wait!");
    await context.wait(2);
    console.log("Hello world after wait!");
    return "Function Completed";
  },
);
