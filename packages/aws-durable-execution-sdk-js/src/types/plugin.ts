import { Operation } from "@aws-sdk/client-lambda";

/**
 * Information about a durable operation.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface OperationInfo {
  Id: string;
  HashedId: string;
  Name?: string;
  Type: string;
  SubType?: string;
  ParentId?: string;
  HashedParentId?: string;
  StartTimestamp?: Date;
  EndTimestamp?: Date;
}

/**
 * Information provided when a durable operation ends.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface OperationEndInfo extends OperationInfo {
  error?: Error;
}

/**
 * Information about an operation attempt.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AttemptInfo extends OperationInfo {
  Attempt: number;
}

/**
 * Possible outcomes for an operation attempt.
 *
 * @experimental This enum is experimental and may be changed or removed in future releases.
 */
export enum AttemptEndInfoOutcome {
  SUCCEEDED = "succeeded",
  FAILED = "failed",
  RETRYING = "retrying",
}

/**
 * Information provided when an operation attempt ends.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AttemptEndInfo extends AttemptInfo {
  outcome:
    | AttemptEndInfoOutcome.SUCCEEDED
    | AttemptEndInfoOutcome.FAILED
    | AttemptEndInfoOutcome.RETRYING;
  error?: Error;
  nextAttemptDelaySeconds?: number;
}

/**
 * Information about a durable execution invocation.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface InvocationInfo {
  requestId: string;
  executionArn: string;
  isFirstInvocation: boolean;
}

/**
 * Information provided when a durable execution ends.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface ExecutionEndInfo extends InvocationInfo {
  status: "SUCCEEDED" | "FAILED";
  executionResult?: unknown;
  executionError?: Error;
  executionInput: unknown;
  operations: Record<string, Operation>;
}

/**
 * Information provided when operations change during execution.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface OperationChangeInfo extends InvocationInfo {
  updatedOperations: Record<string, Operation>;
  operations: Record<string, Operation>;
}

/**
 * Plugin interface for instrumenting durable execution lifecycle events.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface DurableInstrumentationPlugin {
  onExecutionEnd?(info: ExecutionEndInfo): void;
  onInvocationStart?(info: InvocationInfo): void;
  wrapInvocation?(info: InvocationInfo, fn: CustomerFn): CustomerFnResult;
  onInvocationEnd?(info: InvocationInfo): void;
  onOperationFirstStart?(info: OperationInfo): void;
  onOperationStart?(info: OperationInfo): void;
  wrapChildContextFn?(info: OperationInfo, fn: CustomerFn): CustomerFnResult;
  onOperationFirstEnd?(info: OperationEndInfo): void;
  onOperationAttemptStart?(info: AttemptInfo): void;
  wrapOperationAttemptFn?(info: AttemptInfo, fn: CustomerFn): CustomerFnResult;
  onOperationAttemptEnd?(info: AttemptEndInfo): void;
  onOperationChange?(info: OperationChangeInfo): void;
  enrichLogContext?(): Record<string, string | number | boolean> | undefined;
}

/**
 * Internal type aliases used by the plugin.
 *
 * @experimental These types are experimental and may be changed or removed in future releases.
 */
export type CustomerFnResult = unknown;
export type CustomerFn = () => CustomerFnResult;
