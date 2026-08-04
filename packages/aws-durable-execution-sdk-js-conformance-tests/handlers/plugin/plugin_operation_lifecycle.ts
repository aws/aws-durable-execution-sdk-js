// 10-2: Plugin operation lifecycle hooks (step start and terminal end)
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

// Instrumentation plugin that reports step-operation lifecycle via CloudWatch.
// Filters to step-type operations only (subType === "Step"). operation-start
// fires when the step's STARTED checkpoint is observed; operation-end fires when
// the step reaches its terminal status, carrying the operation-status enum token.
// onInvocationStart is present only to capture the execution ARN (it emits
// nothing) so operation records can carry it as a top-level field.
const operationLifecyclePlugin: DurableInstrumentationPlugin = {
  async onInvocationStart(info) {
    capturedArn = info.executionArn;
  },
  async onOperationStart(info) {
    if (info.subType !== "Step") return;
    emit({
      plugin: "CONFPLUGIN",
      hook: "operation-start",
      op: info.id,
    });
  },
  async onOperationEnd(info) {
    if (info.subType !== "Step") return;
    emit({
      plugin: "CONFPLUGIN",
      hook: "operation-end",
      op: info.id,
      status: info.status,
    });
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(async () => {
      return `Hello, ${event}!`;
    });
    return result;
  },
  { plugins: [operationLifecyclePlugin] },
);
