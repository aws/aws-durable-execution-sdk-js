// 10-1: Plugin invocation lifecycle hooks (start and end on a single invocation)
import {
  DurableContext,
  DurableInstrumentationPlugin,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Instrumentation plugin that reports the invocation lifecycle via CloudWatch.
// invocation-start fires (synchronously) before handler code runs; invocation-end
// fires after the execution result is finalized, carrying the terminal status.
const invocationLifecyclePlugin: DurableInstrumentationPlugin = {
  async onInvocationStart(info) {
    console.log(`CONFPLUGIN invocation-start first=${info.isFirstInvocation}`);
  },
  async onInvocationEnd(info) {
    console.log(`CONFPLUGIN invocation-end status=${info.status}`);
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(async (stepContext) => {
      stepContext.logger.info(`Greeting step running for: ${event}`);
      return `Hello, ${event}!`;
    });
    return result;
  },
  { plugins: [invocationLifecyclePlugin] },
);
