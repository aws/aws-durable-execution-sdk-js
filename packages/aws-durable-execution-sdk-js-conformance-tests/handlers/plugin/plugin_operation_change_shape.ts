// 10-22: Operation-change hook info field shape (interface-shape probe)
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
  InvocationInfo,
  OperationChangeInfo,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

function isStep(type?: string): boolean {
  return (type || "").toUpperCase() === "STEP";
}

// INTERFACE-SHAPE probe: every logged field is read from the CURRENT hook's own
// info parameter (the change info and the DELTA ITEM's own OperationInfo) —
// never reconstructed from another hook or from plugin state. When the SDK's
// info type does not expose a field, the corresponding has_* flag is emitted
// false; that omission is the honest signal of a missing API surface. The
// reference item shape is the full operation info (identity + status +
// payloads), not a reduced change-item record.
function makePlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void =>
    process.stdout.write(JSON.stringify({ ...rec, durableExecutionArn: executionArn }) + "\n");

  return {
    async onInvocationStart(info: InvocationInfo): Promise<void> {
      // ARN captured only for durableExecutionArn stamping (unasserted).
      executionArn = info.executionArn;
    },
    async onOperationChange(info: OperationChangeInfo): Promise<void> {
      const fullMap = info.operations;
      // `has_arn` probes whether the change info itself carries the ARN.
      const hasArn = info.executionArn != null && info.executionArn !== "";
      for (const [id, op] of Object.entries(info.updatedOperations)) {
        if (!isStep(op.type)) continue;
        emit({
          plugin: PLUGIN,
          hook: "operation-change",
          op: id,
          status: op.status,
          // Whether the same op id also appears in the info's full operations map.
          in_full_map: id in fullMap,
          has_arn: hasArn,
          // The DELTA ITEM's own field surface.
          item_name: op.name,
          item_type: (op.type || "").toUpperCase(),
          item_has_result: op.result != null,
          item_has_end_time: op.endTimestamp != null,
          item_has_attempt: op.attempt != null,
          // The item exposes a replay indicator (isReplay field is present).
          item_has_replay: "isReplay" in op,
        });
      }
    },
  };
}

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    return await context.step("greet", async () => "task-a");
  },
  { plugins: [makePlugin()] },
);
