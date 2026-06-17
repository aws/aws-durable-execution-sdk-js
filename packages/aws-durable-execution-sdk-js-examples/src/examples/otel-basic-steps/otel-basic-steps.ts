import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";
import { createOtelTestSetup } from "../otel-shared/otel-test-setup";

const { plugin, exporter, getSerializedSpans } = createOtelTestSetup();

export const config: ExampleConfig = {
  name: "OTel Basic Steps",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    exporter.reset();

    const result1 = await context.step("step-1", async () => "step-1-result");
    const result2 = await context.step("step-2", async () => "step-2-result");
    const result3 = await context.step("step-3", async () => "step-3-result");

    return {
      result: `${result1}:${result2}:${result3}`,
      spans: getSerializedSpans(),
    };
  },
  { plugins: [plugin] },
);
