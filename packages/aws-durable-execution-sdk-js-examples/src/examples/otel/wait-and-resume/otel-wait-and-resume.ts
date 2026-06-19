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

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    exporter.reset();

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
