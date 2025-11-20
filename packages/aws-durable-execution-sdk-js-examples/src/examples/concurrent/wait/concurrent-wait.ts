import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Concurrent Wait",
  description: "Start multiple wait operations with Promise.all",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    log("Before waits");
    await Promise.all([
      context.wait("wait-1-second", { seconds: 1 }),
      context.wait("wait-5-seconds", { seconds: 5 }),
      context.wait("wait-10-seconds", { seconds: 10 }),
    ]);
    log("After waits");
    return "Completed waits";
  },
);
