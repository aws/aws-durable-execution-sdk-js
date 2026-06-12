import { Operation } from "@aws-sdk/client-lambda";
import {
  OperationInfo,
  AttemptInfo,
  AttemptEndInfo,
  AttemptEndInfoOutcome,
} from "../../types/plugin";

/**
 * Converts an Operation to an OperationInfo.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function toOperationInfo(operation?: Operation): OperationInfo {
  return {
    id: operation?.Id ?? "",
    name: operation?.Name,
    type: operation?.Type ?? "",
    subType: operation?.SubType,
    parentId: operation?.ParentId,
    status: operation?.Status,
    startTimestamp: operation?.StartTimestamp,
    endTimestamp: operation?.EndTimestamp,
    result:
      operation?.StepDetails?.Result ??
      operation?.CallbackDetails?.Result ??
      operation?.ContextDetails?.Result ??
      operation?.ChainedInvokeDetails?.Result,
    isReplay: false,
  };
}

/**
 * Converts a Record of Operations to a Record of OperationInfo.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function toOperationInfoMap(
  operations: Record<string, Operation>,
): Record<string, OperationInfo> {
  const result: Record<string, OperationInfo> = {};
  for (const [key, op] of Object.entries(operations)) {
    result[key] = toOperationInfo(op);
  }
  return result;
}

/**
 * Converts an Operation to an AttemptInfo.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function toAttemptInfo(
  operation?: Operation,
  attempt?: number,
): AttemptInfo {
  return {
    ...toOperationInfo(operation),
    attempt: attempt ?? (operation?.StepDetails?.Attempt || 0),
  };
}

/**
 * Converts an Operation to an AttemptEndInfo with the given outcome.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function toAttemptEndInfo(
  operation: Operation | undefined,
  outcome: AttemptEndInfoOutcome,
  options?: {
    attempt?: number;
    error?: Error;
    nextAttemptDelaySeconds?: number;
  },
): AttemptEndInfo {
  return {
    ...toAttemptInfo(operation, options?.attempt),
    outcome,
    error: options?.error,
    nextAttemptDelaySeconds: options?.nextAttemptDelaySeconds,
  };
}

/**
 * Backfills missing fields on an OperationInfo (or subtype) with the provided defaults.
 * Only sets a field if it's not already present (undefined or empty string).
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function backfillOperationInfo<T extends OperationInfo>(
  info: T,
  defaults: Partial<OperationInfo>,
): T {
  info.id = defaults.id ?? "";
  if (!info.type) info.type = defaults.type ?? "";
  if (!info.subType) info.subType = defaults.subType;
  if (!info.name) info.name = defaults.name;
  if (!info.parentId) info.parentId = defaults.parentId;
  if (!info.startTimestamp) info.startTimestamp = defaults.startTimestamp;
  if (!info.endTimestamp) info.endTimestamp = defaults.endTimestamp;
  return info;
}
