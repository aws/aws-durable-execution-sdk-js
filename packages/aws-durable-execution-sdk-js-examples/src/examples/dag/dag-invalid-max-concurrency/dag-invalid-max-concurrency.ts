import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Dag Invalid Max Concurrency",
  description:
    "An invalid maxConcurrency (<= 0) is a non-retryable config error that " +
    "fails the execution (rather than being silently ignored or leaving the " +
    "invocation PENDING).",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    // Invalid: must be a positive number or undefined to use the default.
    // This terminates the execution with a CONFIG_VALIDATION_ERROR (FAILED)
    // before any task starts.
    const result = await context.dag(
      "bad-concurrency",
      (d) => {
        d.step("unreachable", [], async (): Promise<string> => "unreachable");
      },
      { maxConcurrency: 0 },
    );

    return {
      completionReason: result.completionReason,
    };
  },
);
