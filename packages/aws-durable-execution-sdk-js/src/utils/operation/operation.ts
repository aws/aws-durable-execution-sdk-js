import { Operation, OperationStatus } from "@aws-sdk/client-lambda";
import {
  OperationInfo,
  AttemptInfo,
  AttemptEndInfo,
  AttemptEndInfoOutcome,
} from "../../types/plugin";

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
    Status: operation?.Status,
    StartTimestamp: operation?.StartTimestamp,
    EndTimestamp: operation?.EndTimestamp,
    Result:
      operation?.StepDetails?.Result ??
      operation?.CallbackDetails?.Result ??
      operation?.ContextDetails?.Result ??
      operation?.ChainedInvokeDetails?.Result,
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
    Attempt: attempt ?? (operation?.StepDetails?.Attempt || 0),
  };
}
/**
 * Extracts an Error from the operation's detail fields when the status is FAILED.
 * Checks StepDetails, ChainedInvokeDetails, and CallbackDetails for error data.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function extractErrorFromOperation(
  operation: Operation,
): Error | undefined {
  if (operation.Status === OperationStatus.FAILED) {
    const errorData =
      operation.StepDetails?.Error ??
      operation.ChainedInvokeDetails?.Error ??
      operation.CallbackDetails?.Error;
    if (errorData?.ErrorMessage) {
      return new Error(errorData.ErrorMessage);
    }
  }
  return undefined;
}
