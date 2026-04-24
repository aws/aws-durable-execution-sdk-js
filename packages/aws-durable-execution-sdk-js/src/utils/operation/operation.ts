import { Operation } from "@aws-sdk/client-lambda";
import {
  OperationInfo,
  AttemptInfo,
  AttemptEndInfo,
  AttemptEndInfoOutcome,
} from "../../types/plugin";

export function toOperationInfo(operation?: Operation): OperationInfo {
  return {
    Id: operation?.Id ?? "",
    Name: operation?.Name,
    Type: operation?.Type ?? "",
    SubType: operation?.SubType,
    ParentId: operation?.ParentId,
    StartTimestamp: operation?.StartTimestamp,
    EndTimestamp: operation?.EndTimestamp,
  };
}

export function toAttemptInfo(
  operation?: Operation,
  attempt?: number,
): AttemptInfo {
  return {
    ...toOperationInfo(operation),
    Attempt: attempt ?? (operation?.StepDetails?.Attempt || 0),
  };
}

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
 */
export function backfillOperationInfo<T extends OperationInfo>(
  info: T,
  defaults: Partial<OperationInfo>,
): T {
  if (!info.Id) info.Id = defaults.Id ?? "";
  if (!info.Type) info.Type = defaults.Type ?? "";
  if (!info.SubType) info.SubType = defaults.SubType;
  if (!info.Name) info.Name = defaults.Name;
  if (!info.ParentId) info.ParentId = defaults.ParentId;
  if (!info.StartTimestamp) info.StartTimestamp = defaults.StartTimestamp;
  if (!info.EndTimestamp) info.EndTimestamp = defaults.EndTimestamp;
  return info;
}
