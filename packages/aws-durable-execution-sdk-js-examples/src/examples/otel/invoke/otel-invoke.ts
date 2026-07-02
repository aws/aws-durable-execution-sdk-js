import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createOtelTestSetup } from "../shared/otel-test-setup";

const { plugin, exporter, getSerializedSpans } = createOtelTestSetup();

export const config: ExampleConfig = {
  name: "OTel Invoke",
  durableConfig: null,
  localOnly: true,
};

/**
 * Reset the span exporter. Call this before running the handler
 * to get a clean set of spans for the test.
 */
export function resetExporter(): void {
  exporter.reset();
}

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
    };
  },
  { plugins: [plugin] },
);
