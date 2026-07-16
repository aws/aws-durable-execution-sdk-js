import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
import { ExampleConfig } from "../../../types";
import { xrayE2eWorkflow } from "../shared/xray-e2e-workflow";

/**
 * ADOT-layer variant of the standalone-xray-e2e example.
 *
 * Exercises the exact same workflow (steps, wait, child context) as
 * otel-community-collector-execution-xray-e2e but uses the ExecutionOtelPlugin with
 * useDefaultTracerProvider: true, backed by the ADOT Lambda layer's
 * globally registered TracerProvider. This allows direct trace comparison
 * between the two plugin implementations in X-Ray.
 */
const plugin = new ExecutionOtelPlugin({ useDefaultTracerProvider: true });

export const config: ExampleConfig = {
  name: "OTel ADOT Execution XRay E2E",
  durableConfig: {
    ExecutionTimeout: 120,
    RetentionPeriodInDays: 7,
  },
  excludeRuntimes: ["24.x"],
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const { xRayHeader, step1, step2, childResult } =
      await xrayE2eWorkflow(context);

    return {
      xRayHeader,
      result: { step1, step2, childResult },
    };
  },
  { plugins: [plugin] },
);
