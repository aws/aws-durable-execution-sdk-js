// 10-7: Plugin invocation-end hook receives FAILED status when execution fails
import {
  DurableContext,
  DurableInstrumentationPlugin,
  retryPresets,
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
// The single step always throws with no retries, so the execution fails and the
// invocation-end hook fires with the FAILED terminal status.
const terminalFailurePlugin: DurableInstrumentationPlugin = {
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
