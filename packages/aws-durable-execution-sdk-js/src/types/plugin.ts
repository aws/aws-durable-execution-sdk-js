import { Operation } from "@aws-sdk/client-lambda";
import { DurableExecutionInvocationOutput } from "./core";

/**
 * Status enumeration for plugin invocation end hooks.
 *
 * This enum is separate from the core InvocationStatus and provides
 * richer status information for plugin authors, including a RETRYING
 * state that indicates the Lambda runtime will automatically retry.
 *
 * @experimental This enum is experimental and may be changed or removed in future releases.
 */
export enum PluginInvocationStatus {
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  PENDING = "PENDING",
  RETRYING = "RETRYING",
}

/**
 * Information about a durable operation.
 *
 * The `Id` and `ParentId` fields always contain hashed values as returned
 * by the checkpoint response.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface OperationInfo {
  Id: string;
  Name?: string;
  Type: string;
  SubType?: string;
  ParentId?: string;
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
 * Base information identifying a durable execution invoke.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface InvocationBaseInfo {
  requestId: string;
  durableExecutionArn: string;
}

/**
 * Information about a durable execution invocation, including whether it is
 * the first invocation (execution mode) or a subsequent replay.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface InvocationInfo extends InvocationBaseInfo {
  isFirstInvocation: boolean;
}

/**
 * Information provided when a durable execution invocation ends, including
 * the invocation status and contextual details about the outcome.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface InvocationEndInfo extends InvocationInfo {
  status: PluginInvocationStatus;
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
export interface OperationChangeInfo extends InvocationBaseInfo {
  updatedOperations: Record<string, Operation>;
  operations: Record<string, Operation>;
}

/**
 * Plugin interface for instrumenting durable execution lifecycle events.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface DurableInstrumentationPlugin {
  onInvocationStart?(info: InvocationInfo): void;
  wrapInvocation?(
    info: InvocationInfo,
    fn: () => Promise<DurableExecutionInvocationOutput>,
  ): Promise<DurableExecutionInvocationOutput>;
  onInvocationEnd?(info: InvocationEndInfo): void;
  onOperationStart?(info: OperationInfo): void;
  onOperationEnd?(info: OperationEndInfo): void;
  wrapChildContextFn?(info: OperationInfo, fn: CustomerFn): CustomerFnResult;
  wrapOperationAttemptFn?(info: AttemptInfo, fn: CustomerFn): CustomerFnResult;
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
