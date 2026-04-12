import { Operation, OperationUpdate } from "@aws-sdk/client-lambda";

export interface OperationInfo {
  Id: string;
  Name?: string;
  Type: string;
  SubType?: string;
  ParentId?: string;
  StartTimestamp?: Date;
}

export interface AttemptInfo extends OperationInfo {
  Attempt: number;
}

export interface AttemptEndInfo extends AttemptInfo {
  outcome: "succeeded" | "failed" | "retrying";
  error?: Error;
  nextAttemptDelaySeconds?: number;
}

export interface InvocationInfo {
  requestId: string;
  executionArn: string;
}

export interface ExecutionEndInfo extends InvocationInfo {
  status: "SUCCEEDED" | "FAILED";
  executionResult?: unknown;
  executionError?: Error;
  executionInput: unknown;
  operations: Record<string, Operation>;
}

export interface OperationChangeInfo extends InvocationInfo {
  updatedOperations: Record<string, Operation>;
  operations: Record<string, Operation>;
}

export interface DurableInstrumentationPlugin {
  onExecutionStart?(info: InvocationInfo): void;
  onExecutionEnd?(info: ExecutionEndInfo): void;
  onInvocationStart?(info: InvocationInfo): void;
  onInvocationEnd?(info: InvocationInfo): void;
  onOperationStart?(info: OperationInfo): void;
  onOperationEnd?(info: OperationInfo & { error?: Error }): void;
  onOperationAttemptStart?(info: AttemptInfo): void;
  onOperationAttemptEnd?(info: AttemptEndInfo): void;
  onOperationChange?(info: OperationChangeInfo): void;
  enrichLogContext?(): Record<string, string | number | boolean> | undefined;
}

export function shouldSampleExecution(
  executionArn: string,
  samplingRate: number,
): boolean {
  if (samplingRate >= 1.0) return true;
  if (samplingRate <= 0.0) return false;
  let hash = 0x811c9dc5;
  for (let i = 0; i < executionArn.length; i++) {
    hash ^= executionArn.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash / 0xffffffff < samplingRate;
}
