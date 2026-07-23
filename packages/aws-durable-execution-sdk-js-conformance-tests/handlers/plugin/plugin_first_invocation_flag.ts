// 10-6: Plugin sees is-first-invocation true once, then false on replay
import {
  DurableContext,
  DurableInstrumentationPlugin,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Instrumentation plugin that reports the first-invocation flag across replay.
// invocation-start logs first=true on the initial invocation and first=false on
// the replay that resumes after the wait. The terminal invocation-end carries
// SUCCEEDED; a non-terminal invocation-end on suspend carries a non-SUCCEEDED
// status and is not asserted by the requirement.
const firstInvocationPlugin: DurableInstrumentationPlugin = {
  async onInvocationStart(info) {
    console.log(`CONFPLUGIN invocation-start first=${info.isFirstInvocation}`);
  },
  async onInvocationEnd(info) {
    console.log(`CONFPLUGIN invocation-end status=${info.status}`);
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    await context.wait({ seconds: 2 });
    return "Wait completed";
  },
  { plugins: [firstInvocationPlugin] },
);
