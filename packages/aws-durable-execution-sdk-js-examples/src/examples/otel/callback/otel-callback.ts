import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createOtelTestSetup } from "../shared/otel-test-setup";

const { plugin, exporter, getSerializedSpans } = createOtelTestSetup();

export const config: ExampleConfig = {
  name: "OTel Callback",
  durableConfig: null,
  localOnly: true,
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    exporter.reset();

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
    };
  },
  { plugins: [plugin] },
);
