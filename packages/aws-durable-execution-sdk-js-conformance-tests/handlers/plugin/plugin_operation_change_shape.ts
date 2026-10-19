// 10-22: Operation-change hook info field shape (canonical dump)
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
  InvocationInfo,
  OperationChangeInfo,
  OperationInfo,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

function isStep(type?: string): boolean {
  return (type || "").toUpperCase() === "STEP";
}

function iso(d?: Date): string | undefined {
  return d != null ? new Date(d).toISOString() : undefined;
}

function compact(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

// CANONICAL DUMP: one record per step-type DELTA ITEM. Each record dumps the
// item's own full operation field surface at top level (canonical camelCase;
// type upper-cased; timestamps ISO-8601; result raw serialized string; error
// message), plus the hook-level fields (executionArn, map-size counts) and the
// derived scalar inFullMap := the id also appears in the info's full map.
function makePlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void =>
    process.stdout.write(
      JSON.stringify({ ...compact(rec), durableExecutionArn: executionArn }) + "\n",
    );

  return {
    async onInvocationStart(info: InvocationInfo): Promise<void> {
      // ARN captured only for durableExecutionArn stamping (unasserted).
      executionArn = info.executionArn;
    },
    async onOperationChange(info: OperationChangeInfo): Promise<void> {
      const updatedOperationsCount = Object.keys(info.updatedOperations).length;
      const operationsCount = Object.keys(info.operations).length;
      for (const [id, op] of Object.entries(info.updatedOperations)) {
        if (!isStep(op.type)) continue;
        const item = op as OperationInfo;
        emit({
          plugin: PLUGIN,
          hook: "operation-change",
          // Hook-level fields from the change info itself.
          executionArn: info.executionArn,
          updatedOperationsCount,
          operationsCount,
          // Derived: the same id also appears in the info's full operations map.
          inFullMap: id in info.operations,
          // The delta item's own operation field surface, dumped at top level.
          id: item.id,
          name: item.name,
          type: item.type != null ? item.type.toUpperCase() : undefined,
          subType: item.subType,
          parentId: item.parentId,
          status: item.status,
          startTimestamp: iso(item.startTimestamp),
          endTimestamp: iso(item.endTimestamp),
          result: item.result,
          error: item.error != null ? item.error.message : undefined,
          attempt: item.attempt,
          isReplay: item.isReplay,
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
