import { Operation } from "@aws-sdk/client-lambda";
import { OperationInfo, AttemptInfo } from "../../types/plugin";

/**
 * Converts an Operation to an OperationInfo.
 * The Id and ParentId fields always contain hashed values as returned
 * by the checkpoint response.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
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
  if (!info.Type) info.Type = defaults.Type ?? "";
  if (!info.SubType) info.SubType = defaults.SubType;
  if (!info.Name) info.Name = defaults.Name;
  if (!info.ParentId) info.ParentId = defaults.ParentId;
  if (!info.StartTimestamp) info.StartTimestamp = defaults.StartTimestamp;
  if (!info.EndTimestamp) info.EndTimestamp = defaults.EndTimestamp;
  return info;
}
