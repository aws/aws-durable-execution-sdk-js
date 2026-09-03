// 10-6: Plugin sees is-first-invocation true once, then false on replay
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
  const line =
    arn === undefined ? record : { ...record, durableExecutionArn: arn };
  process.stdout.write(JSON.stringify(line) + "\n");
}

// Instrumentation plugin that reports the first-invocation flag across replay.
// invocation-start logs first=true on the initial invocation and first=false on
// the replay that resumes after the wait. The terminal invocation-end carries
// SUCCEEDED; a non-terminal invocation-end on suspend carries a non-SUCCEEDED
// status and is not asserted by the requirement.
const firstInvocationPlugin: DurableInstrumentationPlugin = {
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
    await context.wait({ seconds: 2 });
    return "Wait completed";
  },
  { plugins: [firstInvocationPlugin] },
);
