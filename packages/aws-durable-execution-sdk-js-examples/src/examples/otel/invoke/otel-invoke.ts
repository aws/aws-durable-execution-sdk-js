import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createDualModeOtelSetup } from "../shared/otel-test-setup";

const { plugin, getSerializedSpans, resetExporter, getXRayHeader } =
  createDualModeOtelSetup();

export const config: ExampleConfig = {
  name: "OTel Invoke",
};

export { getSerializedSpans, resetExporter };

export const handler = withDurableExecution(
  async (event: { functionName: string }, context: DurableContext) => {
    const beforeInvoke = await context.step(
      "before-invoke",
      async () => "before-invoke-value",
    );

    const invokeResult = await context.invoke(
      "invoke-target",
      event.functionName,
      { data: "invoke-payload" },
    );

    const afterInvoke = await context.step(
      "after-invoke",
      async () => "after-invoke-value",
    );

    return {
      invokeResult,
      beforeInvoke,
      afterInvoke,
      spans: getSerializedSpans(),
      xRayHeader: getXRayHeader(),
    };
  },
  { plugins: [plugin] },
);
