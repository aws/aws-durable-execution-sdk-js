import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createDualModeOtelSetup } from "../shared/otel-test-setup";

const { plugin, getSerializedSpans, resetExporter } = createDualModeOtelSetup();

export const config: ExampleConfig = {
  name: "OTel Basic Steps",
  excludeRuntimes: ["24.x"],
};

export { getSerializedSpans, resetExporter };

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const result1 = await context.step("step-1", async () => "step-1-result");
    const result2 = await context.step("step-2", async () => "step-2-result");
    const result3 = await context.step("step-3", async () => "step-3-result");

    return {
      result: `${result1}:${result2}:${result3}`,
      spans: getSerializedSpans(),
      xRayHeader: process.env._X_AMZN_TRACE_ID,
    };
  },
  { plugins: [plugin] },
);
