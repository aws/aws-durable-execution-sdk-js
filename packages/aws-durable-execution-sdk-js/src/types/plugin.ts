import { Operation } from "@aws-sdk/client-lambda";

export interface OperationInfo {
  Id: string;
  Name?: string;
  Type: string;
  SubType?: string;
  ParentId?: string;
  StartTimestamp?: Date;
  EndTimestamp?: Date;
}

export interface AttemptInfo extends OperationInfo {
  Attempt: number;
}

export enum AttemptEndInfoOutcome {
  SUCCEEDED = "succeeded",
  FAILED = "failed",
  RETRYING = "retrying",
}

export interface AttemptEndInfo extends AttemptInfo {
  outcome:
    | AttemptEndInfoOutcome.SUCCEEDED
    | AttemptEndInfoOutcome.FAILED
    | AttemptEndInfoOutcome.RETRYING;
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
  wrapInvocation?<T>(info: InvocationInfo, fn: () => T): T;
  onInvocationEnd?(info: InvocationInfo): void;
  onOperationFirstStart?(info: OperationInfo): void;
  onOperationStart?(info: OperationInfo): void;
  wrapChildContextFn?<T>(info: OperationInfo, fn: () => T): T;
  onOperationFirstEnd?(info: OperationInfo & { error?: Error }): void;
  onOperationAttemptStart?(info: AttemptInfo): void;
  wrapOperationAttemptFn?<T>(info: AttemptInfo, fn: () => T): T;
  onOperationAttemptEnd?(info: AttemptEndInfo): void;
  onOperationChange?(info: OperationChangeInfo): void;
  enrichLogContext?(): Record<string, string | number | boolean> | undefined;
}
