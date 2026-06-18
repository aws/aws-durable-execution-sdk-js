import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createOtelTestSetup } from "../shared/otel-test-setup";

const { plugin, exporter, provider, getSerializedSpans } =
  createOtelTestSetup();

// Register the provider so that context propagation (AsyncLocalStorage) is active.
// This enables enrichLogContext to find the active span and inject traceId/spanId into logs.
provider.register();

export const config: ExampleConfig = {
  name: "OTel Log Enrichment",
  durableConfig: null, // Exclude from catalog - local-only test
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    exporter.reset();

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
