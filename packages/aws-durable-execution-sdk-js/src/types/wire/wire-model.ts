import { OperationAction, OperationStatus, OperationType } from "./wire-enums";

/**
 * A timestamp as it appears on the durable execution wire protocol, before normalization.
 *
 * Timestamps reach the SDK by more than one transport, and those transports do not agree on
 * a single runtime representation of the same logical field:
 *
 * - The Lambda invocation event ({@link DurableExecutionInvocationInput}) is plain JSON
 *   parsed by the runtime, so timestamps arrive as ISO-8601 **strings**
 *   (for example `"2026-07-13T22:11:27.127Z"`).
 * - Responses fetched through the Lambda API are deserialized by the AWS SDK, which
 *   converts timestamps into **`Date`** instances.
 *
 * This union, together with `normalizeOperation`, is the designated absorption point for
 * that kind of per-transport difference: a transport that represents timestamps some other
 * way is accommodated by widening this union and teaching `toDate` to parse it, without
 * touching {@link Operation} or anything downstream of it.
 *
 * The union therefore appears only on the raw shapes — {@link WireOperation} and the API
 * response types. The SDK normalizes every operation as it enters, so {@link Operation} and
 * everything downstream carry real `Date`s.
 *
 * @public
 */
export type WireTimestamp = Date | string;

/**
 * A serialized error recorded against a durable operation.
 *
 * @public
 */
export interface ErrorObject {
  /** Human-readable error message. */
  ErrorMessage?: string | undefined;
  /** Error class or type name. */
  ErrorType?: string | undefined;
  /** Serialized custom error payload, if the error carried structured data. */
  ErrorData?: string | undefined;
  /** Stack trace lines, when available. */
  StackTrace?: string[] | undefined;
}

/**
 * Details specific to the root execution operation.
 *
 * @public
 */
export interface ExecutionDetails {
  /** Serialized input payload the execution was started with. */
  InputPayload?: string | undefined;
}

/**
 * Details specific to a child context operation.
 *
 * @public
 */
export interface ContextDetails {
  /** Whether the context's children are retained for replay rather than pruned. */
  ReplayChildren?: boolean | undefined;
  /** Serialized result of the context, when it completed successfully. */
  Result?: string | undefined;
  /** Recorded error, when the context failed. */
  Error?: ErrorObject | undefined;
}

/**
 * Details specific to a step operation, with timestamps normalized to `Date`.
 *
 * @public
 */
export interface StepDetails {
  /** Zero-based attempt counter for the step. */
  Attempt?: number | undefined;
  /** When the next retry attempt becomes eligible to run. */
  NextAttemptTimestamp?: Date | undefined;
  /** Serialized result of the step, when it completed successfully. */
  Result?: string | undefined;
  /** Recorded error, when the step failed. */
  Error?: ErrorObject | undefined;
}

/**
 * {@link StepDetails} as it appears on the wire, before timestamp normalization.
 *
 * @public
 */
export interface WireStepDetails extends Omit<
  StepDetails,
  "NextAttemptTimestamp"
> {
  /** When the next retry attempt becomes eligible to run. */
  NextAttemptTimestamp?: WireTimestamp | undefined;
}

/**
 * Details specific to a wait operation, with timestamps normalized to `Date`.
 *
 * @public
 */
export interface WaitDetails {
  /** When the wait is scheduled to elapse. */
  ScheduledEndTimestamp?: Date | undefined;
}

/**
 * {@link WaitDetails} as it appears on the wire, before timestamp normalization.
 *
 * @public
 */
export interface WireWaitDetails {
  /** When the wait is scheduled to elapse. */
  ScheduledEndTimestamp?: WireTimestamp | undefined;
}

/**
 * Details specific to a callback operation.
 *
 * @public
 */
export interface CallbackDetails {
  /** Identifier external systems use to complete the callback. */
  CallbackId?: string | undefined;
  /** Serialized result delivered by the callback, when it succeeded. */
  Result?: string | undefined;
  /** Recorded error, when the callback failed or timed out. */
  Error?: ErrorObject | undefined;
}

/**
 * Details specific to a durable invoke of another function.
 *
 * @public
 */
export interface ChainedInvokeDetails {
  /** Serialized result returned by the invoked execution, when it succeeded. */
  Result?: string | undefined;
  /** Recorded error, when the invoked execution failed. */
  Error?: ErrorObject | undefined;
}

/**
 * A single entry in a durable execution's operation history, with timestamps normalized
 * to `Date`.
 *
 * This is the form the SDK works with internally and exposes through
 * {@link DurableContext} and the instrumentation plugin surface. Operations are
 * normalized from {@link WireOperation} as they enter the SDK, so consumers never have to
 * deal with the wire's dual timestamp representation.
 *
 * Exactly one of the `*Details` members is populated, selected by {@link Operation.Type}.
 *
 * @public
 */
export interface Operation {
  /** Hashed operation identifier, unique within the execution. */
  Id: string | undefined;
  /** Hashed identifier of the enclosing operation, if any. */
  ParentId?: string | undefined;
  /** Caller-supplied operation name. */
  Name?: string | undefined;
  /** Which kind of operation this entry represents. */
  Type: OperationType | undefined;
  /** SDK-level refinement of {@link Operation.Type}, such as a map or parallel context. */
  SubType?: string | undefined;
  /** When the operation started. */
  StartTimestamp: Date | undefined;
  /** When the operation reached a terminal status, if it has. */
  EndTimestamp?: Date | undefined;
  /** Current lifecycle status of the operation. */
  Status: OperationStatus | undefined;
  /** Populated when `Type` is `EXECUTION`. */
  ExecutionDetails?: ExecutionDetails | undefined;
  /** Populated when `Type` is `CONTEXT`. */
  ContextDetails?: ContextDetails | undefined;
  /** Populated when `Type` is `STEP`. */
  StepDetails?: StepDetails | undefined;
  /** Populated when `Type` is `WAIT`. */
  WaitDetails?: WaitDetails | undefined;
  /** Populated when `Type` is `CALLBACK`. */
  CallbackDetails?: CallbackDetails | undefined;
  /** Populated when `Type` is `CHAINED_INVOKE`. */
  ChainedInvokeDetails?: ChainedInvokeDetails | undefined;
}

/**
 * {@link Operation} as it appears on the wire, before timestamp normalization.
 *
 * This is the shape carried by the Lambda invocation event and by API responses. Prefer
 * {@link Operation} everywhere else.
 *
 * @public
 */
export interface WireOperation extends Omit<
  Operation,
  "StartTimestamp" | "EndTimestamp" | "StepDetails" | "WaitDetails"
> {
  /** When the operation started. */
  StartTimestamp: WireTimestamp | undefined;
  /** When the operation reached a terminal status, if it has. */
  EndTimestamp?: WireTimestamp | undefined;
  /** Populated when `Type` is `STEP`. */
  StepDetails?: WireStepDetails | undefined;
  /** Populated when `Type` is `WAIT`. */
  WaitDetails?: WireWaitDetails | undefined;
}

/**
 * Checkpoint options specific to a child context operation.
 *
 * @public
 */
export interface ContextOptions {
  /** Request that the context's children be retained for replay rather than pruned. */
  ReplayChildren?: boolean | undefined;
}

/**
 * Checkpoint options specific to a step operation.
 *
 * @public
 */
export interface StepOptions {
  /** Delay the service should wait before the next retry attempt becomes eligible. */
  NextAttemptDelaySeconds?: number | undefined;
}

/**
 * Checkpoint options specific to a wait operation.
 *
 * @public
 */
export interface WaitOptions {
  /** How long the service should suspend the execution. */
  WaitSeconds?: number | undefined;
}

/**
 * Checkpoint options specific to a callback operation.
 *
 * @public
 */
export interface CallbackOptions {
  /** How long the service waits for the callback before timing it out. */
  TimeoutSeconds?: number | undefined;
  /** How long the service waits between callback heartbeats before timing it out. */
  HeartbeatTimeoutSeconds?: number | undefined;
}

/**
 * Checkpoint options specific to a durable invoke of another function.
 *
 * @public
 */
export interface ChainedInvokeOptions {
  /** Qualified name or ARN of the function to invoke. */
  FunctionName: string | undefined;
  /** Tenant the invoked execution should run under, when using tenant isolation. */
  TenantId?: string | undefined;
}

/**
 * A requested state transition for a single operation within a checkpoint.
 *
 * Exactly one of the `*Options` members is populated, selected by
 * {@link OperationUpdate.Type}.
 *
 * @public
 */
export interface OperationUpdate {
  /** Hashed operation identifier, unique within the execution. */
  Id: string | undefined;
  /** Hashed identifier of the enclosing operation, if any. */
  ParentId?: string | undefined;
  /** Caller-supplied operation name. */
  Name?: string | undefined;
  /** Which kind of operation this update applies to. */
  Type: OperationType | undefined;
  /** SDK-level refinement of {@link OperationUpdate.Type}. */
  SubType?: string | undefined;
  /** The state transition being requested. */
  Action: OperationAction | undefined;
  /** Serialized result payload, for a succeeding operation. */
  Payload?: string | undefined;
  /** Serialized error, for a failing operation. */
  Error?: ErrorObject | undefined;
  /** Populated when `Type` is `CONTEXT`. */
  ContextOptions?: ContextOptions | undefined;
  /** Populated when `Type` is `STEP`. */
  StepOptions?: StepOptions | undefined;
  /** Populated when `Type` is `WAIT`. */
  WaitOptions?: WaitOptions | undefined;
  /** Populated when `Type` is `CALLBACK`. */
  CallbackOptions?: CallbackOptions | undefined;
  /** Populated when `Type` is `CHAINED_INVOKE`. */
  ChainedInvokeOptions?: ChainedInvokeOptions | undefined;
}

/**
 * Execution state returned alongside a checkpoint response.
 *
 * @public
 */
export interface CheckpointUpdatedExecutionState {
  /** Operations whose state changed as a result of the checkpoint. */
  Operations?: WireOperation[] | undefined;
  /** Pagination marker, when the operation history did not fit in one response. */
  NextMarker?: string | undefined;
}

/**
 * Request shape for the CheckpointDurableExecution API.
 *
 * @public
 */
export interface CheckpointDurableExecutionRequest {
  /** ARN identifying the durable execution being checkpointed. */
  DurableExecutionArn: string | undefined;
  /** Token authorizing this checkpoint for the current invocation. */
  CheckpointToken: string | undefined;
  /** Operation state transitions to persist. */
  Updates?: OperationUpdate[] | undefined;
  /** Idempotency token for the checkpoint request. */
  ClientToken?: string | undefined;
}

/**
 * Response shape for the CheckpointDurableExecution API.
 *
 * @public
 */
export interface CheckpointDurableExecutionResponse {
  /** Token to use for the next checkpoint. */
  CheckpointToken?: string | undefined;
  /** Execution state as of the accepted checkpoint. */
  NewExecutionState: CheckpointUpdatedExecutionState | undefined;
}

/**
 * Request shape for the GetDurableExecutionState API.
 *
 * @public
 */
export interface GetDurableExecutionStateRequest {
  /** ARN identifying the durable execution to read. */
  DurableExecutionArn: string | undefined;
  /** Token authorizing this read for the current invocation. */
  CheckpointToken: string | undefined;
  /** Pagination marker from a previous response. */
  Marker?: string | undefined;
  /** Maximum number of operations to return. */
  MaxItems?: number | undefined;
}

/**
 * Response shape for the GetDurableExecutionState API.
 *
 * @public
 */
export interface GetDurableExecutionStateResponse {
  /** Page of operations from the execution history. */
  Operations: WireOperation[] | undefined;
  /** Pagination marker, when more operations remain. */
  NextMarker?: string | undefined;
}
