import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Configurable Wait",
  description: "Wait with a configurable duration passed via the event payload",
};

export const handler = withDurableExecution(
  async (event: { waitSeconds?: number }, context: DurableContext) => {
    const seconds = event.waitSeconds ?? 2;
    await context.wait("configurable-wait", { seconds });
    return "wait finished";
  },
);
