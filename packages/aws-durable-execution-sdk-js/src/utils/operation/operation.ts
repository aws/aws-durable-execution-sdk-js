import { Operation } from "@aws-sdk/client-lambda";
import {
  OperationInfo,
  AttemptInfo,
  AttemptEndInfo,
  AttemptEndInfoOutcome,
} from "../../types/plugin";
import { hashId } from "../step-id-utils/step-id-utils";

/**
 * Converts an Operation to an OperationInfo.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function toOperationInfo(operation?: Operation): OperationInfo {
  return {
    Id: operation?.Id ?? "",
    HashedId: hashId(operation?.Id ?? ""),
    Name: operation?.Name,
    Type: operation?.Type ?? "",
    SubType: operation?.SubType,
    ParentId: operation?.ParentId,
    HashedParentId: operation?.ParentId
      ? hashId(operation.ParentId)
      : undefined,
    StartTimestamp: operation?.StartTimestamp,
    EndTimestamp: operation?.EndTimestamp,
  };
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
    Attempt: attempt ?? (operation?.StepDetails?.Attempt || 0),
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
  info.Id = defaults.Id ?? "";
  info.HashedId = defaults.HashedId ?? hashId(info.Id);
  if (!info.Type) info.Type = defaults.Type ?? "";
  if (!info.SubType) info.SubType = defaults.SubType;
  if (!info.Name) info.Name = defaults.Name;
  if (!info.ParentId) info.ParentId = defaults.ParentId;
  if (!info.HashedParentId)
    info.HashedParentId =
      defaults.HashedParentId ??
      (info.ParentId ? hashId(info.ParentId) : undefined);
  if (!info.StartTimestamp) info.StartTimestamp = defaults.StartTimestamp;
  if (!info.EndTimestamp) info.EndTimestamp = defaults.EndTimestamp;
  return info;
}
