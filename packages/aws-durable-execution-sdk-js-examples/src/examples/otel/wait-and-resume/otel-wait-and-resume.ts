import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createDualModeOtelSetup } from "../shared/otel-test-setup";

const { plugin, getSerializedSpans, resetExporter } = createDualModeOtelSetup();

export const config: ExampleConfig = {
  name: "OTel Wait and Resume",
  excludeRuntimes: ["24.x"],
};

export { getSerializedSpans, resetExporter };

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const beforeWait = await context.step(
      "before-wait",
      async () => "before-wait-value",
    );
    await context.wait("short-wait", { seconds: 5 });
    const afterWait = await context.step(
      "after-wait",
      async () => "after-wait-value",
    );

    return {
      beforeWait,
      afterWait,
      spans: getSerializedSpans(),
      xRayHeader: process.env._X_AMZN_TRACE_ID,
    };
  },
  { plugins: [plugin] },
);
