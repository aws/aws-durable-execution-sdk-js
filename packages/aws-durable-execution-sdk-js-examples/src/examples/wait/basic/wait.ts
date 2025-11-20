import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Wait State",
  description: "Basic usage of context.wait() to pause execution",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    log("Hello world before wait!");
    await context.wait({ seconds: 2 });
    log("Hello world after wait!");
    return "Function Completed";
  },
);
