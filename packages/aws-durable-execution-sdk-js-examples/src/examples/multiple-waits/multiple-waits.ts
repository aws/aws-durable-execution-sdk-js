import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Multiple Waits",
  description:
    "Demonstrates sequential wait operations creating multiple invocations",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    await context.wait("wait-1", { seconds: 5 });
    await context.wait("wait-2", { seconds: 5 });

    return {
      completedWaits: 2,
      finalStep: "done",
    };
  },
);
