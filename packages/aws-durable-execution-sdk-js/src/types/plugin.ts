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
export const PluginInvocationStatus = {
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  PENDING: "PENDING",
  RETRYING: "RETRYING",
} as const;

export type PluginInvocationStatus =
  (typeof PluginInvocationStatus)[keyof typeof PluginInvocationStatus];

/**
 * Status values for durable operations.
 *
 * These represent the lifecycle states that an operation can be in
 * during durable execution.
 *
 * @experimental This enum is experimental and may be changed or removed in future releases.
 */
export const PluginOperationStatus = {
  STARTED: "STARTED",
  READY: "READY",
  PENDING: "PENDING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  TIMED_OUT: "TIMED_OUT",
  STOPPED: "STOPPED",
  CANCELLED: "CANCELLED",
} as const;

export type PluginOperationStatus =
  (typeof PluginOperationStatus)[keyof typeof PluginOperationStatus];

/**
 * Information about a durable operation.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface OperationInfo {
  id: string;
  name?: string;
  type: string;
  subType?: string;
  parentId?: string;
  status?: PluginOperationStatus;
  startTimestamp?: Date;
  endTimestamp?: Date;
  result?: string;
  isReplay: boolean;
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
  attempt: number;
}

/**
 * Possible outcomes for an operation attempt.
 *
 * @experimental This enum is experimental and may be changed or removed in future releases.
 */
export const AttemptEndInfoOutcome = {
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  RETRYING: "RETRYING",
} as const;

export type AttemptEndInfoOutcome =
  (typeof AttemptEndInfoOutcome)[keyof typeof AttemptEndInfoOutcome];

/**
 * Information provided when an operation attempt ends.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AttemptEndInfo extends AttemptInfo {
  outcome: AttemptEndInfoOutcome;
  error?: Error;
  nextAttemptDelaySeconds?: number;
}

/**
 * Base information identifying a durable execution invoke.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface InvocationBaseInfo {
  requestId: string;
  executionArn: string;
}

/**
 * Information about a durable execution invocation, including whether it is
 * the first invocation (execution mode) or a subsequent replay.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface InvocationInfo extends InvocationBaseInfo {
  isFirstInvocation: boolean;
  executionInput: unknown;
  operations: Record<string, OperationInfo>;
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
  operations: Record<string, OperationInfo>;
}

/**
 * Information provided when operations change during execution.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface OperationChangeInfo extends InvocationBaseInfo {
  updatedOperations: Record<string, OperationInfo>;
  operations: Record<string, OperationInfo>;
}

/**
 * Plugin interface for instrumenting durable execution lifecycle events.
 *
 * @remarks
 * **Await contract:** every non-`wrap` lifecycle hook in this interface
 * (`onInvocationStart`, `onInvocationEnd`, and the `onOperation*` hooks)
 * returns `Promise<void>` and is **awaited** by the SDK before execution
 * proceeds past the corresponding lifecycle point. A hook that performs
 * asynchronous work can therefore rely on that work completing before the
 * SDK moves on — for example, before the next operation runs, or before the
 * Lambda response is returned. Hooks across multiple plugins are invoked
 * concurrently, and the SDK waits for all of them to settle. Errors thrown
 * or promises rejected by a hook are swallowed by the SDK and never affect
 * the execution outcome.
 *
 * Because hooks are awaited, any time spent in a hook directly increases the
 * wall-clock duration of the current Lambda invocation.
 *
 * **Opting out (fire-and-forget):** to avoid blocking the SDK, start the
 * background work inside the hook but return without awaiting it, so the
 * returned promise resolves immediately:
 *
 * ```typescript
 * onOperationEnd(info) {
 *   // Start background work without awaiting it, then return.
 *   void this.exporter.export(info).catch(() => {});
 * }
 * ```
 *
 * Such detached work is **best-effort**: in Lambda the execution environment
 * is frozen once the invocation returns, so any unfinished background work may
 * be suspended and is not guaranteed to resume or complete. Do **not** use
 * this pattern in `onInvocationEnd` — it runs immediately before the Lambda
 * response is returned, so detached work started there will almost never
 * complete. Instead, treat `onInvocationEnd` as the place to flush: await any
 * outstanding fire-and-forget work started by earlier hooks before resolving
 * its promise.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface DurableInstrumentationPlugin {
  onInvocationStart?(info: InvocationInfo): Promise<void>;
  wrapInvocation?(
    info: InvocationInfo,
    fn: () => Promise<DurableExecutionInvocationOutput>,
  ): Promise<DurableExecutionInvocationOutput>;
  /**
   * Called once when a durable execution invocation ends, with the final
   * status and outcome details.
   *
   * The SDK **awaits** this hook before returning the Lambda response, which
   * guarantees the hook runs to completion before the Lambda environment is
   * frozen or torn down.
   *
   * @remarks
   * Because the SDK awaits this hook, any time spent here directly increases
   * the wall-clock duration of the current Lambda invocation. Errors thrown
   * (or rejected promises) are swallowed by the SDK and never affect the
   * execution outcome.
   *
   * Do not start fire-and-forget work here and leave it un-awaited: this hook
   * runs right before the Lambda response is returned, so the environment is
   * frozen immediately afterward and such work will not complete. This is the
   * correct place to await any background work started by earlier hooks before
   * resolving.
   *
   * @param info - Details about the completed invocation, including status,
   * result or error, input, and operations.
   */
  onInvocationEnd?(info: InvocationEndInfo): Promise<void>;
  onOperationStart?(info: OperationInfo): Promise<void>;
  wrapChildContextFn?(info: OperationInfo, fn: CustomerFn): CustomerFnResult;
  onOperationEnd?(info: OperationEndInfo): Promise<void>;
  onOperationAttemptStart?(info: AttemptInfo): Promise<void>;
  wrapOperationAttemptFn?(info: AttemptInfo, fn: CustomerFn): CustomerFnResult;
  onOperationAttemptEnd?(info: AttemptEndInfo): Promise<void>;
  onOperationChange?(info: OperationChangeInfo): Promise<void>;
  enrichLogContext?(): Record<string, string | number | boolean> | undefined;
}

/**
 * Internal type aliases used by the plugin.
 *
 * @experimental These types are experimental and may be changed or removed in future releases.
 */
export type CustomerFnResult = unknown;
export type CustomerFn = () => CustomerFnResult;
