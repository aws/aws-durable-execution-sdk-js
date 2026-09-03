// 10-4: Plugin exceptions are swallowed and never affect the execution outcome
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

// Faulty instrumentation plugin: every hook first logs its line and then throws.
// The SDK must catch and ignore every plugin exception, so the execution result
// and history are identical to running without the plugin. Operation/attempt
// hooks filter to step-type operations only.
const faultyPlugin: DurableInstrumentationPlugin = {
  async onInvocationStart(info) {
    capturedArn = info.executionArn;
    emit(
      { plugin: "CONFPLUGIN-FAULTY", hook: "invocation-start" },
      info.executionArn,
    );
    throw new Error("faulty invocation-start");
  },
  async onInvocationEnd(info) {
    emit(
      { plugin: "CONFPLUGIN-FAULTY", hook: "invocation-end" },
      info.executionArn,
    );
    throw new Error("faulty invocation-end");
  },
  async onOperationStart(info) {
    if (info.subType !== "Step") return;
    emit({ plugin: "CONFPLUGIN-FAULTY", hook: "operation-start" });
    throw new Error("faulty operation-start");
  },
  async onOperationEnd(info) {
    if (info.subType !== "Step") return;
    emit({ plugin: "CONFPLUGIN-FAULTY", hook: "operation-end" });
    throw new Error("faulty operation-end");
  },
  async onOperationAttemptStart(info) {
    if (info.subType !== "Step") return;
    emit({ plugin: "CONFPLUGIN-FAULTY", hook: "attempt-start" });
    throw new Error("faulty attempt-start");
  },
  async onOperationAttemptEnd(info) {
    if (info.subType !== "Step") return;
    emit({ plugin: "CONFPLUGIN-FAULTY", hook: "attempt-end" });
    throw new Error("faulty attempt-end");
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(async () => {
      return `Hello, ${event}!`;
    });
    return result;
  },
  { plugins: [faultyPlugin] },
);
