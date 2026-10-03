// 10-6: Plugin sees is-first-invocation true once, then false on replay
import {
  DurableContext,
  DurableInstrumentationPluginFactory,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Instrumentation plugin that reports the first-invocation flag across replay.
// invocation-start logs first=true on the initial invocation and first=false on
// the replay that resumes after the wait. The terminal invocation-end carries
// SUCCEEDED; a non-terminal invocation-end on suspend carries a non-SUCCEEDED
// status and is not asserted by the requirement.
//
// The SDK builds one instance per invocation, so the replay is observed as a
// second call to this factory's `createPlugin` with a fresh InvocationInfo
// rather than as a second hook call on a reused object.
const firstInvocationPlugin: DurableInstrumentationPluginFactory = {
  createPlugin: (invocation) => {
    // Emit one record as a raw top-level JSON line (unwrapped by the Node runtime's
    // JSON log envelope). The execution ARN is a top-level field so the runner's
    // CloudWatch JSON filter ($.durableExecutionArn) matches the raw log line.
    const emit = (record: Record<string, unknown>): void => {
      process.stdout.write(
        JSON.stringify({
          ...record,
          durableExecutionArn: invocation.executionArn,
        }) + "\n",
      );
    };

    return {
      async onInvocationStart(info) {
        emit({
          plugin: "CONFPLUGIN",
          hook: "invocation-start",
          first: info.isFirstInvocation,
        });
      },
      async onInvocationEnd(info) {
        emit({
          plugin: "CONFPLUGIN",
          hook: "invocation-end",
          status: info.status,
        });
      },
    };
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    await context.wait({ seconds: 2 });
    return "Wait completed";
  },
  { plugins: [firstInvocationPlugin] },
);
