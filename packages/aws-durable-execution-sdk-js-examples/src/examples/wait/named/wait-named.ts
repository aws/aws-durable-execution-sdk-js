import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Named Wait",
  description: "Using context.wait() with a custom name",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    log("Starting wait operation");
    await context.wait("wait-2-seconds", { seconds: 2 });
    log("Wait completed");
    return "wait finished";
  },
);
