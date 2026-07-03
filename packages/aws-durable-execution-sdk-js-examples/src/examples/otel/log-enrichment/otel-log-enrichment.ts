import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import {
  createDualModeOtelSetup,
  createOtelTestSetup,
  isAdotEnvironment,
} from "../shared/otel-test-setup";

// Log enrichment requires provider.register() for AsyncLocalStorage context propagation.
// In cloud mode with ADOT, this is handled by the ADOT layer. In local mode, we register manually.
const localSetup = !isAdotEnvironment() ? createOtelTestSetup() : undefined;
if (localSetup) {
  localSetup.provider.register();
}

const dualSetup = createDualModeOtelSetup();
// In local mode, use the registered provider's plugin for log enrichment to work
const plugin = localSetup ? localSetup.plugin : dualSetup.plugin;

export const config: ExampleConfig = {
  name: "OTel Log Enrichment",
};

export function getSerializedSpans() {
  return localSetup
    ? localSetup.getSerializedSpans()
    : dualSetup.getSerializedSpans();
}

export function resetExporter(): void {
  if (localSetup) {
    localSetup.reset();
  } else {
    dualSetup.resetExporter();
  }
}

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const step1Result = await context.step("log-step-1", async () => {
      context.logger.info("Executing log step 1");
      return "step-1-done";
    });

    const step2Result = await context.step("log-step-2", async () => {
      context.logger.info("Executing log step 2");
      return "step-2-done";
    });

    return {
      step1Result,
      step2Result,
      spans: getSerializedSpans(),
      xRayHeader: dualSetup.getXRayHeader(),
    };
  },
  { plugins: [plugin] },
);
