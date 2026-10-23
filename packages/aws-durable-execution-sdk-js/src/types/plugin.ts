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
  /**
   * Error details, when available. Checkpoint-derived metadata can omit this
   * field when wire error data is missing or empty, including during replay
   * and `onOperationChange`. A lifecycle hook may also supply a runtime error.
   *
   * Use `status` to identify an operation failure; absence of `error` does not
   * imply success. Supplied partial error details are retained, including
   * explicitly empty strings or an empty stack trace.
   */
  error?: Error;
  /**
   * The current attempt number for the operation (1-based), when applicable
   * (e.g. steps). Sourced from the checkpointed step details.
   */
  attempt?: number;
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
}

/**
 * Base information identifying a durable execution invoke.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface InvocationBaseInfo {
  requestId: string;
  executionArn: string;
  executionInput: unknown;
  operations: Record<string, OperationInfo>;
  /**
   * The timestamp when the overall durable execution was first started,
   * as reported by the backend. This remains the same across all
   * invocations (including replays) of a given execution.
   */
  executionStartTimestamp?: Date;
}

/**
 * Information about a durable execution invocation, including whether it is
 * the first invocation (execution mode) or a subsequent replay.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface InvocationInfo extends InvocationBaseInfo {
  /**
   * Invocation-local X-Ray header supplied by the Lambda runtime (including LMI).
   * An empty string means the runtime exposes the carrier but has no header,
   * or the optional carrier could not be safely read. Omission preserves legacy
   * environment fallback when no carrier is available.
   */
  xRayTraceId?: string;
  isFirstInvocation: boolean;
  /**
   * Operations that were updated externally between the previous invocation and this one
   * (e.g., a wait timer expired, a callback was received, or a chained invoke completed).
   *
   * This is a subset of `operations` containing only those whose status changed since the
   * last checkpoint. On the first invocation this will be an empty record.
   *
   * Populated from the `UpdatedOperationIds` field in the durable Lambda invocation input.
   */
  updatedOperations: Record<string, OperationInfo>;
}

/**
 * Information provided when a durable execution invocation ends, including
 * the invocation status and contextual details about the outcome.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface InvocationEndInfo extends InvocationBaseInfo {
  status: PluginInvocationStatus;
  executionResult?: unknown;
  executionError?: Error;
}

/**
 * Information provided when operations change during execution.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface OperationChangeInfo {
  executionArn: string;
  updatedOperations: Record<string, OperationInfo>;
  operations: Record<string, OperationInfo>;
}

/**
 * Plugin interface for instrumenting durable execution lifecycle events.
 *
 * @remarks
 * **Hooks do not block operations.** The SDK calls each operation hook
 * (`onOperationStart`, `onOperationEnd`, `onOperationAttemptStart`,
 * `onOperationAttemptEnd` and `onOperationChange`) and continues without
 * waiting for the promise it returns. A slow hook therefore cannot delay an
 * operation, and cannot hold off the invocation's suspension.
 *
 * - The synchronous part of a hook still runs before the SDK continues. Hooks
 *   are called in lifecycle order. For nested operations that order is
 *   `parent start → child start → child end → parent end`. A plugin can rely on
 *   state that a hook sets synchronously, for example a span that a later
 *   `wrap` hook looks up.
 * - The order applies to the calls, not to the asynchronous work the hooks
 *   start. That work can overlap and finish in any order. For example, a slow
 *   `onOperationEnd` for a child can finish after the parent's. A plugin that
 *   needs its asynchronous work in order must queue it itself.
 * - `onInvocationStart` is still awaited. It runs before any operation, so
 *   waiting for it delays no operation, and a plugin can finish its setup
 *   there.
 * - The `wrap` hooks run the customer's function and stay inline. If a `wrap`
 *   hook throws or rejects for its own reasons, the SDK continues with the
 *   wrappers inside it and the customer function, and uses their result. So
 *   one failing wrapper does not skip another plugin's wrapper. An error from
 *   the customer function always reaches the caller.
 *
 * **Drain.** Before it calls `onInvocationEnd`, the SDK waits for the
 * asynchronous work of every earlier hook to settle. It then waits for
 * `onInvocationEnd` itself. Two deadlines bound these waits:
 *
 * 1. The drain of earlier hook work stops 500 ms before the invocation's
 *    deadline.
 * 2. The wait for `onInvocationEnd` stops 50 ms before the deadline, so the SDK
 *    can still return the Lambda response.
 *
 * So `onInvocationEnd` keeps its time even when earlier hook work is slow, and
 * an invocation that ends close to its timeout still flushes. Work that has not
 * settled by its deadline is abandoned, and the invocation returns. In Lambda
 * the execution environment is then frozen, so abandoned work may never
 * complete. If the context reports no deadline, both waits last until
 * everything settles.
 *
 * Errors thrown or promises rejected by any hook are swallowed by the SDK and
 * never affect the execution outcome.
 */
export interface DurableInstrumentationPlugin {
  /**
   * Synchronously supplies SDK-owned metadata for a prospective chained invoke.
   * Omit the hook or return undefined for no metadata. The collector isolates
   * plugin failures and keeps the first non-null value for each supported field.
   *
   * Called only when preparing a new invoke START, before checkpoint serialization.
   * Replaying a persisted START does not call the hook. An uncommitted START can
   * call it again on retry, so implementations must use the stable input identity
   * and avoid side effects. Transport requires the Lambda model and backend to
   * support ChainedInvokeOptions.XAmznTraceId.
   */
  providePropagationMetadata?(
    input: PropagationInput,
  ): PropagationMetadata | undefined;
  onInvocationStart?(info: InvocationInfo): Promise<void>;
  wrapInvocation?(
    info: InvocationInfo,
    fn: () => Promise<DurableExecutionInvocationOutput>,
  ): Promise<DurableExecutionInvocationOutput>;
  /**
   * Called once when a durable execution invocation ends, with the final
   * status and outcome details.
   *
   * The SDK calls this hook after the asynchronous work of every earlier hook
   * has settled, or after that wait reached its own deadline, 500 ms before the
   * invocation's deadline. The SDK then **awaits** this hook until 50 ms before
   * the invocation's deadline. If the hook has not settled by then, the SDK
   * returns the response without waiting further.
   *
   * @remarks
   * Time spent here increases the wall-clock duration of the current Lambda
   * invocation. Errors thrown (or rejected promises) are swallowed by the SDK
   * and never affect the execution outcome.
   *
   * Do not start fire-and-forget work here and leave it un-awaited: this hook
   * runs right before the Lambda response is returned, so the environment is
   * frozen immediately afterward and such work will not complete. This is the
   * place to flush exporters and other buffered work.
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
 * Immutable identity of a prospective chained-invoke operation.
 * @experimental This interface is experimental and may change.
 */
export interface PropagationInput {
  readonly executionArn: string;
  readonly operationId: string;
  readonly parentOperationId?: string;
  readonly targetFunctionName: string;
}

/**
 * SDK-owned propagation values, independent of Lambda wire and OTel types.
 * @experimental This interface is experimental and may change.
 */
export interface PropagationMetadata {
  readonly xAmznTraceId?: string;
}

/**
 * Creates the plugin instance that serves a single durable execution invocation.
 *
 * @remarks
 * This is the only way to install a plugin. The SDK calls
 * {@link DurableInstrumentationPluginFactory.createPlugin} once per invocation,
 * so every instance it returns is used by exactly one invocation: created
 * before that invocation's first hook fires and dropped when the invocation
 * returns. Nothing an instance holds survives into the next invocation, so an
 * instance never has to key its per-execution state by execution ARN, and two
 * executions running concurrently in one execution environment (as Lambda
 * Managed Instances makes routine) cannot observe each other's state.
 *
 * State that belongs to the execution environment rather than to one
 * invocation — a shared exporter, a tracer provider, a scheduler — belongs on
 * the factory itself or in its closure, where it outlives the instances the
 * factory hands out.
 *
 * `createPlugin` receives the same {@link InvocationInfo} object that is then
 * passed to {@link DurableInstrumentationPlugin.onInvocationStart}, so an
 * instance can take its identity at construction rather than waiting for the
 * first hook.
 *
 * Errors thrown by `createPlugin` are contained exactly like errors thrown by a
 * plugin hook: the invocation proceeds without that plugin and the execution
 * outcome is unaffected. The same holds for a `createPlugin` that returns
 * nothing. Factories must return synchronously. Promise-like results are
 * unsupported and skipped; their rejections are observed to preserve error
 * isolation for JavaScript providers.
 *
 * A package that supports environment-based plugin loading exports one of these
 * factories as `durableExecutionPluginProvider`; the SDK loads only the modules
 * listed in `DURABLE_EXECUTION_PLUGINS`.
 *
 * This is an object with a method rather than a bare function so that later
 * additions to the contract stay additive. A hook that belongs to the process
 * rather than to one invocation — flushing on execution environment shutdown,
 * for example — can be added here as an optional second member, which every
 * existing factory keeps satisfying. A function type has nowhere to put such a
 * member, so adding one would have to change the type's kind, and that is a
 * breaking change for every caller.
 *
 * @example
 * ```typescript
 * const exporter = new Exporter(); // shared by every invocation
 *
 * export const handler = withDurableExecution(myHandler, {
 *   plugins: [
 *     { createPlugin: (info) => new MyPlugin(exporter, info.executionArn) },
 *   ],
 * });
 * ```
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export interface DurableInstrumentationPluginFactory<
  Plugin extends DurableInstrumentationPlugin = DurableInstrumentationPlugin,
> {
  /**
   * Synchronously creates the plugin instance for the described invocation.
   *
   * @param info - The invocation the returned instance will observe. This is
   * the same object {@link DurableInstrumentationPlugin.onInvocationStart}
   * receives.
   * @returns The plugin instance serving this invocation, and no other, or
   * `null` or `undefined` to skip instrumentation for this invocation.
   */
  createPlugin(info: InvocationInfo): Plugin | null | undefined;
}

/**
 * Internal type aliases used by the plugin.
 *
 * @experimental These types are experimental and may be changed or removed in future releases.
 */
export type CustomerFnResult = unknown;
export type CustomerFn = () => CustomerFnResult;

/**
 * Opt-in registration metadata key. Ordinary plugin properties remain untouched.
 * Symbol.for keeps the protocol shared across application and Lambda-layer copies.
 * @experimental
 */
export const DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION = Symbol.for(
  "aws.lambda.durable.instrumentation.plugin-registration",
);

/** @experimental Optional registration protocol, separate from the hook interface. */
export interface RegisteredDurableInstrumentationPlugin
  extends DurableInstrumentationPlugin {
  readonly [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION]: {
    readonly name: string;
    readonly exclusiveGroup?: string;
  };
}

/**
 * Factory registration is checked without constructing a plugin. Every declared
 * group on the factory's prototype chain applies; an own declaration adds a
 * constraint rather than replacing an inherited one. Diagnostics retain the
 * nearest declared registration name.
 * @experimental
 */
export interface RegisteredDurableInstrumentationPluginFactory
  extends DurableInstrumentationPluginFactory {
  readonly [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION]: RegisteredDurableInstrumentationPlugin[typeof DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION];
}
