// 10-5: Multiple registered plugins all receive lifecycle hooks
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

// Two instrumentation plugins registered together (order A, B). Each reports the
// invocation lifecycle under its own prefix. The SDK delivers hooks to every
// registered plugin.
const pluginA: DurableInstrumentationPlugin = {
  async onInvocationStart(info) {
    capturedArn = info.executionArn;
    emit(
      { plugin: "CONFPLUGIN-A", hook: "invocation-start" },
      info.executionArn,
    );
  },
  async onInvocationEnd(info) {
    emit(
      {
        plugin: "CONFPLUGIN-A",
        hook: "invocation-end",
        status: info.status,
      },
      info.executionArn,
    );
  },
};

const pluginB: DurableInstrumentationPlugin = {
  async onInvocationStart(info) {
    capturedArn = info.executionArn;
    emit(
      { plugin: "CONFPLUGIN-B", hook: "invocation-start" },
      info.executionArn,
    );
  },
  async onInvocationEnd(info) {
    emit(
      {
        plugin: "CONFPLUGIN-B",
        hook: "invocation-end",
        status: info.status,
      },
      info.executionArn,
    );
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(async () => {
      return `Hello, ${event}!`;
    });
    return result;
  },
  { plugins: [pluginA, pluginB] },
);
