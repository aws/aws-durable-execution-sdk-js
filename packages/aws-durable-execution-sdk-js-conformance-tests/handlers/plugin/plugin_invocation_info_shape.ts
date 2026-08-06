// 10-19: Invocation hook info field shape (canonical dump)
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
  InvocationInfo,
  InvocationEndInfo,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";
const TERMINAL = new Set(["SUCCEEDED", "FAILED"]);

// ISO-8601 string for a timestamp value; undefined when the field is unset so
// the key is omitted from the record.
function iso(d?: Date): string | undefined {
  return d != null ? new Date(d).toISOString() : undefined;
}

// Drops keys whose value is undefined OR null so a field the SDK's info type
// does not expose is OMITTED from the record — a missing key fails its
// assertion, which is the parity signal.
function compact(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

// CANONICAL DUMP: every logged field is read one-to-one from the CURRENT hook's
// own info parameter and emitted under its canonical camelCase name. Map-typed
// fields become <name>Count integers; timestamps become ISO-8601 strings.
// Unexposed fields read undefined and are omitted (the honest missing-surface
// signal). No cross-hook reconstruction — never captured from another hook.
function makePlugin(): DurableInstrumentationPlugin {
  // The execution ARN is the ONLY value captured at invocation-start and reused
  // on later records — solely for durableExecutionArn stamping so the runner's
  // CloudWatch filter locates records; it is not asserted.
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void =>
    process.stdout.write(
      JSON.stringify({ ...compact(rec), durableExecutionArn: executionArn }) + "\n",
    );

  return {
    async onInvocationStart(info: InvocationInfo): Promise<void> {
      executionArn = info.executionArn;
      emit({
        plugin: PLUGIN,
        hook: "invocation-start",
        isFirstInvocation: info.isFirstInvocation,
        requestId: info.requestId,
        executionInput: info.executionInput,
        operationsCount: Object.keys(info.operations).length,
        updatedOperationsCount: Object.keys(info.updatedOperations).length,
        executionStartTimestamp: iso(info.executionStartTimestamp),
      });
    },
    async onInvocationEnd(info: InvocationEndInfo): Promise<void> {
      const status = info.status != null ? String(info.status) : undefined;
      // `isFirstInvocation` MUST come from the END info itself — capturing it at
      // invocation-start is forbidden here because the field's presence on the
      // end info is exactly what is under test. The JS InvocationEndInfo does
      // NOT expose isFirstInvocation, so this reads undefined and the key is
      // omitted entirely: the resulting red assertion is the intended signal of
      // the missing API surface.
      const endFirst = (info as InvocationEndInfo & { isFirstInvocation?: boolean })
        .isFirstInvocation;
      emit({
        plugin: PLUGIN,
        hook: "invocation-end",
        isFirstInvocation: endFirst,
        requestId: info.requestId,
        executionInput: info.executionInput,
        operationsCount: Object.keys(info.operations).length,
        executionStartTimestamp: iso(info.executionStartTimestamp),
        status,
        // Derived scalar: reported status is SUCCEEDED or FAILED.
        terminal: status != null ? TERMINAL.has(status) : undefined,
        // The execution result exactly as exposed on the end info, BY VALUE.
        executionResult: info.executionResult,
        executionError: info.executionError != null ? info.executionError.message : undefined,
      });
    },
  };
}

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    await context.wait({ seconds: 2 });
    return `done-${event}`;
  },
  { plugins: [makePlugin()] },
);
