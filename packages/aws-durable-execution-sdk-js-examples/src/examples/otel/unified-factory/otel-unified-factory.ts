import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { OtelPlugin } from "@aws/durable-execution-sdk-js-otel";
import type { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "OTel Unified Factory",
  description:
    "Select a durable OTel view through one factory API and resume a workflow",
};

// Uses the provider configured by ADOT or the application. To parent operations
// under each invocation, use OtelPlugin.factory({ mode: "invocation" }).
const tracing = OtelPlugin.factory();

export const handler = withDurableExecution(
  async (_, context) => {
    const prepared = await context.step("prepare", async () => "prepared");
    await context.wait("pause", { seconds: 1 });
    return context.step("finish", async () => `${prepared} and finished`);
  },
  { plugins: [tracing] },
);
