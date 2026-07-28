import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Parallel Invalid Max Concurrency",
  description:
    "An invalid maxConcurrency (<= 0) is a non-retryable config error that " +
    "fails the execution (rather than being silently ignored or leaving the " +
    "invocation PENDING).",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    // Invalid: must be a positive number or undefined for unlimited
    // concurrency. This terminates the execution with a
    // CONFIG_VALIDATION_ERROR (FAILED) before any branch starts.
    const results = await context.parallel(
      "parallel",
      [async (childContext) => childContext.step(async () => "unreachable")],
      {
        maxConcurrency: 0,
      },
    );

    return results.getResults();
  },
);
