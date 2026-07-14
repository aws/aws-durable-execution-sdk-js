import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Child Operations Invalid Depth",
  description:
    "An invalid pluginsConfig.childOperationsDepth is a non-retryable config " +
    "error that fails the execution (rather than being silently ignored).",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    await context.step("noop", async () => "ok");
    return "done";
  },
  {
    // Invalid: must be a non-negative integer or Infinity. This terminates the
    // execution with a CONFIG_VALIDATION_ERROR (FAILED) before the handler
    // makes durable progress.
    pluginsConfig: { childOperationsDepth: -1 },
  },
);
