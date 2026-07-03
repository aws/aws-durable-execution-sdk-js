import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createDualModeOtelSetup } from "../shared/otel-test-setup";

const { plugin, getSerializedSpans, resetExporter, getXRayHeader } =
  createDualModeOtelSetup();

export const config: ExampleConfig = {
  name: "OTel Child Context",
};

export { getSerializedSpans, resetExporter };

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      "child-ctx",
      async (childCtx: DurableContext) => {
        const a = await childCtx.step(
          "inner-step-1",
          async () => "inner-1-result",
        );
        const b = await childCtx.step(
          "inner-step-2",
          async () => "inner-2-result",
        );
        return `${a}:${b}`;
      },
    );

    return {
      result,
      spans: getSerializedSpans(),
      xRayHeader: getXRayHeader(),
    };
  },
  { plugins: [plugin] },
);
