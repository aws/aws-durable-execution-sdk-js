// 10-1: Plugin invocation lifecycle hooks (start and end on a single invocation)
import {
  DurableContext,
  DurableInstrumentationPlugin,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Execution ARN captured from the invocation-start hook's info, reused as a
// top-level field on every emitted record so the runner's CloudWatch JSON
// filter ($.durableExecutionArn) matches the raw log line.
let capturedArn: string | undefined;

// Emit one record as a raw top-level JSON line (unwrapped by the Node runtime's
// JSON log envelope). Adds durableExecutionArn when an ARN is available; omits
// the field entirely if unset (never invents a value).
function emit(
  record: Record<string, unknown>,
  arn: string | undefined = capturedArn,
): void {
  const line = arn === undefined ? record : { ...record, durableExecutionArn: arn };
  process.stdout.write(JSON.stringify(line) + "\n");
}

// Instrumentation plugin that reports the invocation lifecycle via CloudWatch.
// invocation-start fires (synchronously) before handler code runs; invocation-end
// fires after the execution result is finalized, carrying the terminal status.
const invocationLifecyclePlugin: DurableInstrumentationPlugin = {
  async onInvocationStart(info) {
    capturedArn = info.executionArn;
    emit(
      {
        plugin: "CONFPLUGIN",
        hook: "invocation-start",
        first: info.isFirstInvocation,
      },
      info.executionArn,
    );
  },
  async onInvocationEnd(info) {
    emit(
      {
        plugin: "CONFPLUGIN",
        hook: "invocation-end",
        status: info.status,
      },
      info.executionArn,
    );
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
