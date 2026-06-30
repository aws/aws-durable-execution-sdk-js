import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createOtelTestSetup } from "../shared/otel-test-setup";

const { plugin, exporter, getSerializedSpans } = createOtelTestSetup();

export const config: ExampleConfig = {
  name: "OTel Wait and Resume",
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
  async (event: any, context: DurableContext) => {
    const beforeWait = await context.step(
      "before-wait",
      async () => "before-wait-value",
    );
    await context.wait("short-wait", { seconds: 5 });
    const afterWait = await context.step(
      "after-wait",
      async () => "after-wait-value",
    );

    return { beforeWait, afterWait, spans: getSerializedSpans() };
  },
  { plugins: [plugin] },
);
