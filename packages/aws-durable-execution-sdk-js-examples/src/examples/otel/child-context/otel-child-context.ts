import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createOtelTestSetup } from "../shared/otel-test-setup";

const { plugin, exporter, getSerializedSpans } = createOtelTestSetup();

export const config: ExampleConfig = {
  name: "OTel Child Context",
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

    return { result, spans: getSerializedSpans() };
  },
  { plugins: [plugin] },
);
