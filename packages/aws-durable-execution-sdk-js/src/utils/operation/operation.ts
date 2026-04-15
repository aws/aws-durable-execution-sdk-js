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
