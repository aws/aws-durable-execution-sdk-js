// 10-1: Plugin invocation lifecycle hooks (start and end on a single invocation)
import {
  DurableContext,
  DurableInstrumentationPluginFactory,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Instrumentation plugin that reports the invocation lifecycle via CloudWatch.
// invocation-start fires (synchronously) before handler code runs; invocation-end
// fires after the execution result is finalized, carrying the terminal status.
//
// One instance serves one invocation, so the execution ARN is taken from the
// InvocationInfo handed to the factory and stamped on every emitted record.
const invocationLifecyclePlugin: DurableInstrumentationPluginFactory = {
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
    const result = await context.step(async (stepContext) => {
      stepContext.logger.info(`Greeting step running for: ${event}`);
      return `Hello, ${event}!`;
    });
    return result;
  },
  { plugins: [invocationLifecyclePlugin] },
);
