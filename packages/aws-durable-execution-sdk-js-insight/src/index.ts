import type {
  DurableInstrumentationPlugin,
  InvocationInfo,
  InvocationEndInfo,
  OperationChangeInfo,
  OperationInfo,
} from "@aws/durable-execution-sdk-js";
import type { WorkflowInsightConfig, OperationRecord } from "./types";

export type {
  InsightExporter,
  WorkflowInsightConfig,
  WorkflowInsightRecord,
  OperationRecord,
  ContentConfig,
  OperationOverride,
} from "./types";

function toOperationRecord(op: OperationInfo): OperationRecord {
  const startTime = op.StartTimestamp?.toISOString();
  const endTime = op.EndTimestamp?.toISOString();
  const durationMs =
    op.StartTimestamp && op.EndTimestamp
      ? op.EndTimestamp.getTime() - op.StartTimestamp.getTime()
      : undefined;

  return {
    id: op.Id,
    name: op.Name,
    type: op.Type,
    subType: op.SubType,
    parentId: op.ParentId,
    status: op.Status ?? "UNKNOWN",
    startTime,
    endTime,
    durationMs,
  };
}

function buildOperationRecords(
  operations: Record<string, OperationInfo>,
): OperationRecord[] {
  return Object.values(operations)
    .filter((op) => op.Name)
    .map(toOperationRecord);
}

/**
 * Creates a Workflow Insight plugin that listens to execution lifecycle events.
 * @experimental This function is experimental and may change in future releases.
 */
export function workflowInsight(
  _config: WorkflowInsightConfig,
): DurableInstrumentationPlugin {
  let operationRecords: OperationRecord[] = [];

  return {
    async onInvocationStart(info: InvocationInfo): Promise<void> {
      operationRecords = buildOperationRecords(info.operations);
    },

    async onInvocationEnd(info: InvocationEndInfo): Promise<void> {
      operationRecords = buildOperationRecords(info.operations);
    },

    async onOperationChange(info: OperationChangeInfo): Promise<void> {
      operationRecords = buildOperationRecords(info.operations);
    },
  };
}
