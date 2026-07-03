import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createOtelTestSetup } from "../shared/otel-test-setup";

const { plugin, exporter, provider, getSerializedSpans } =
  createOtelTestSetup();

export { getSerializedSpans };

// Register the provider so that context propagation (AsyncLocalStorage) is active.
// This enables enrichLogContext to find the active span and inject traceId/spanId into logs.
provider.register();

export const config: ExampleConfig = {
  name: "OTel Log Enrichment",
};

/**
 * Reset the span exporter. Call this before running the handler
 * to get a clean set of spans for the test.
 */
export function resetExporter(): void {
  exporter.reset();
}

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const step1Result = await context.step("log-step-1", async () => {
      context.logger.info("Executing log step 1");
      return "step-1-done";
    });

    const step2Result = await context.step("log-step-2", async () => {
      context.logger.info("Executing log step 2");
      return "step-2-done";
    });

    return { step1Result, step2Result, spans: getSerializedSpans() };
  },
  { plugins: [plugin] },
);
