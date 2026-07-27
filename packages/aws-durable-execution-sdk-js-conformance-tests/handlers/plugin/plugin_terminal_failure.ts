// 10-7: Plugin invocation-end hook receives FAILED status when execution fails
import {
  DurableContext,
  DurableInstrumentationPlugin,
  retryPresets,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Instrumentation plugin that reports the invocation lifecycle via CloudWatch.
// The single step always throws with no retries, so the execution fails and the
// invocation-end hook fires with the FAILED terminal status.
const terminalFailurePlugin: DurableInstrumentationPlugin = {
  async onInvocationStart(info) {
    console.log(
      JSON.stringify({
        plugin: "CONFPLUGIN",
        hook: "invocation-start",
        first: info.isFirstInvocation,
      }),
    );
  },
  async onInvocationEnd(info) {
    console.log(
      JSON.stringify({
        plugin: "CONFPLUGIN",
        hook: "invocation-end",
        status: info.status,
      }),
    );
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(
      async () => {
        throw new Error("Something went wrong");
      },
      { retryStrategy: retryPresets.noRetry },
    );
    return result;
  },
  { plugins: [terminalFailurePlugin] },
);
