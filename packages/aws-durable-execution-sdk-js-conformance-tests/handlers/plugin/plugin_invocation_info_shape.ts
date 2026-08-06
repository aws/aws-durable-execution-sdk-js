// 10-19: Invocation hook info field shape (interface-shape probe)
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
  InvocationInfo,
  InvocationEndInfo,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";
const TERMINAL = new Set(["SUCCEEDED", "FAILED"]);

// INTERFACE-SHAPE probe: every logged field is read from the CURRENT hook's own
// info parameter. When the SDK's info type does not expose a field, the
// corresponding has_* flag is emitted false (or the value field omitted); that
// omission is the honest signal of a missing API surface — never reconstructed
// from another hook or from plugin state.
function makePlugin(): DurableInstrumentationPlugin {
  // The execution ARN is the ONLY value captured at invocation-start and reused
  // on later records — it is used solely for durableExecutionArn stamping so the
  // runner's CloudWatch filter locates records; it is not asserted.
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void =>
    process.stdout.write(JSON.stringify({ ...rec, durableExecutionArn: executionArn }) + "\n");

  return {
    async onInvocationStart(info: InvocationInfo): Promise<void> {
      executionArn = info.executionArn;
      emit({
        plugin: PLUGIN,
        hook: "invocation-start",
        first: info.isFirstInvocation,
        has_request_id: info.requestId != null && info.requestId !== "",
        has_input: info.executionInput !== undefined,
        // The execution input value exactly as exposed on the start info.
        input: info.executionInput,
        has_operations: info.operations != null,
        // The info's externally-updated-operations collection is non-empty.
        updated_nonempty: Object.keys(info.updatedOperations).length > 0,
        has_start_time: info.executionStartTimestamp != null,
      });
    },
    async onInvocationEnd(info: InvocationEndInfo): Promise<void> {
      const status = String(info.status);
      const rec: Record<string, unknown> = {
        plugin: PLUGIN,
        hook: "invocation-end",
        // terminal := reported status is SUCCEEDED or FAILED.
        terminal: TERMINAL.has(status),
        status,
        has_result: info.executionResult !== undefined,
        has_error: info.executionError != null,
      };
      // `first` MUST come from the END info itself — capturing it at
      // invocation-start is forbidden here because the field's presence on the
      // end info is exactly what is under test. The JS InvocationEndInfo does
      // NOT expose isFirstInvocation, so this reads undefined and the key is
      // omitted entirely: the resulting red assertion is the intended signal of
      // the missing API surface.
      const endFirst = (info as InvocationEndInfo & { isFirstInvocation?: boolean })
        .isFirstInvocation;
      if (endFirst !== undefined) {
        rec.first = endFirst;
      }
      emit(rec);
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
