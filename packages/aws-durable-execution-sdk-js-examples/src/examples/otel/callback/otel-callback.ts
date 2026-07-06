import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createDualModeOtelSetup } from "../shared/otel-test-setup";

const { plugin, getSerializedSpans, resetExporter } = createDualModeOtelSetup();

export const config: ExampleConfig = {
  name: "OTel Callback",
  excludeRuntimes: ["24.x"],
};

export { getSerializedSpans, resetExporter };

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const beforeCallback = await context.step(
      "before-callback",
      async () => "before-callback-value",
    );

    const callbackResult = await context.waitForCallback(
      "my-callback",
      async (callbackId: string) => {
        // Submitter: in production, would send callbackId to external system
      },
      { timeout: { seconds: 10 } },
    );

    const afterCallback = await context.step(
      "after-callback",
      async () => "after-callback-value",
    );

    return {
      callbackResult,
      beforeCallback,
      afterCallback,
      spans: getSerializedSpans(),
      xRayHeader: process.env._X_AMZN_TRACE_ID,
    };
  },
  { plugins: [plugin] },
);
