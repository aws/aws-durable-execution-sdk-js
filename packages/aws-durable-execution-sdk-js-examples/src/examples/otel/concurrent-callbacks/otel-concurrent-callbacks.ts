import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createDualModeOtelSetup } from "../shared/otel-test-setup";

const { plugin, getSerializedSpans, resetExporter } = createDualModeOtelSetup();

export const config: ExampleConfig = {
  name: "OTel Concurrent Callback",
  excludeRuntimes: ["24.x"],
};

export { getSerializedSpans, resetExporter };

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    // A waitForCallback runs concurrently with a plain, independently-named
    // step. waitForCallback derives plugin operation names for its inner
    // (unnamed) CALLBACK and submitter STEP ("cb-callback" / "cb-submitter").
    // The concurrent "plain-step" must keep its OWN name and never pick up a
    // derived callback name. This is the regression guard: the derived name is
    // passed per-call, so a concurrently-running operation cannot observe it.
    const [callbackResult, plain] = await context.promise.all<string>([
      context.waitForCallback("cb", async (_callbackId: string) => {
        // Submitter: in production would notify an external system.
      }),
      context.step("plain-step", async () => "plain-value"),
    ]);

    return {
      callbackResult,
      plain,
      spans: getSerializedSpans(),
      xRayHeader: process.env._X_AMZN_TRACE_ID,
    };
  },
  { plugins: [plugin] },
);
