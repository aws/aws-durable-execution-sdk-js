// 10-20: Operation hook info field shape (interface-shape probe)
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
  InvocationInfo,
  OperationInfo,
  OperationEndInfo,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

function isStep(type?: string): boolean {
  return (type || "").toUpperCase() === "STEP";
}

// INTERFACE-SHAPE probe: every logged field is read from the CURRENT hook's own
// info parameter. When the SDK's info type does not expose a field, the
// corresponding has_* flag is emitted false (or the value field omitted); that
// omission is the honest signal of a missing API surface.
function makePlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void =>
    process.stdout.write(JSON.stringify({ ...rec, durableExecutionArn: executionArn }) + "\n");

  return {
    async onInvocationStart(info: InvocationInfo): Promise<void> {
      // ARN captured only for durableExecutionArn stamping (unasserted).
      executionArn = info.executionArn;
    },
    async onOperationStart(info: OperationInfo): Promise<void> {
      if (!isStep(info.type)) return;
      emit({
        plugin: PLUGIN,
        hook: "operation-start",
        op: info.id,
        name: info.name,
        type: (info.type || "").toUpperCase(),
        replay: info.isReplay,
        has_start_time: info.startTimestamp != null,
        // Emitted for observability; not asserted at start (status may not be
        // checkpointed yet when the live first-start hook fires).
        has_status: info.status != null,
      });
    },
    async onOperationEnd(info: OperationEndInfo): Promise<void> {
      if (!isStep(info.type)) return;
      const rec: Record<string, unknown> = {
        plugin: PLUGIN,
        hook: "operation-end",
        op: info.id,
        name: info.name,
        type: (info.type || "").toUpperCase(),
        replay: info.isReplay,
        status: info.status,
        has_result: info.result != null,
        has_error: info.error != null,
        // The 1-based attempt number exactly as exposed on the end info.
        attempt: info.attempt,
        has_end_time: info.endTimestamp != null,
      };
      // The operation's checkpointed serialized result exactly as exposed on the
      // info parameter (e.g. '"task-a"'); omitted when unavailable.
      if (info.result != null) {
        rec.result = info.result;
      }
      emit(rec);
    },
  };
}

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    return await context.step("greet", async () => "task-a");
  },
  { plugins: [makePlugin()] },
);
