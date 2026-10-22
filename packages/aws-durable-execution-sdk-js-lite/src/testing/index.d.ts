// Types for @aws/durable-execution-sdk-js-lite/testing. Keep in sync with src/testing/*.js.

import type {
  DurableExecutionClient,
  DurableExecutionOutput,
  DurableHandler,
  ErrorObject,
} from "../index.js";

/** An operation record as the service stores it. Timestamps are epoch seconds. */
export interface Operation {
  Id: string;
  ParentId?: string;
  Name?: string;
  Type: string;
  SubType?: string;
  Status: string;
  StartTimestamp?: number;
  EndTimestamp?: number;
  ExecutionDetails?: { InputPayload?: string };
  StepDetails?: {
    Attempt?: number;
    Result?: string;
    Error?: ErrorObject;
    NextAttemptTimestamp?: number;
  };
  WaitDetails?: { ScheduledEndTimestamp?: number };
  CallbackDetails?: {
    CallbackId?: string;
    Result?: string;
    Error?: ErrorObject;
  };
  ChainedInvokeDetails?: { Result?: string; Error?: ErrorObject };
  ContextDetails?: {
    Result?: string;
    Error?: ErrorObject;
    ReplayChildren?: boolean;
  };
}

/** Return undefined to leave the callback open. */
export type OnCallback = (args: {
  callbackId: string;
  name?: string;
}) =>
  | undefined
  | { result: string }
  | { error: ErrorObject }
  | Promise<undefined | { result: string } | { error: ErrorObject }>;

/** Functions that ctx.invoke can call, by function name. */
export type InvokeFunctions = Record<string, (input: unknown) => unknown>;

export interface InMemoryServiceOptions {
  /** The user event. Stored as ExecutionDetails.InputPayload. */
  input?: unknown;
  onCallback?: OnCallback;
  functions?: InvokeFunctions;
  /** Serve the state in pages of this size, to exercise pagination. */
  pageSize?: number;
}

export interface RunDurableOptions<E, R> extends InMemoryServiceOptions {
  /** The raw workflow, not the withDurableExecution handler. */
  workflow: DurableHandler<E, R>;
  input?: E;
  /** Default 100. */
  maxInvocations?: number;
}

export interface RunDurableResult<R> {
  /** PENDING means the execution is stuck, for example on an unanswered callback. */
  status: "SUCCEEDED" | "FAILED" | "PENDING";
  result?: R;
  error?: ErrorObject;
  /** Every operation in start order. Deep copies. */
  operations: Operation[];
  invocations: number;
  /** The first operation with this Name. */
  getOperation(name: string): Operation | undefined;
}

export function runDurable<E = unknown, R = unknown>(
  options: RunDurableOptions<E, R>,
): Promise<RunDurableResult<R>>;

export interface InvocationInput {
  DurableExecutionArn: string;
  CheckpointToken: string;
  InitialExecutionState: { Operations?: Operation[]; NextMarker?: string };
}

export interface InMemoryService {
  client: DurableExecutionClient;
  /** The live operation records by Id, in start order. */
  ops: Map<string, Operation>;
  /** The virtual clock in epoch seconds. */
  readonly now: number;
  /** The EXECUTION SUCCEED Payload, set on the large-result path. */
  readonly result: string | undefined;
  /** The input for a new invocation, with a fresh token. */
  event(): InvocationInput;
  /** Applies callback answers and invoke results. Resolves to how many it applied. */
  boundary(): Promise<number>;
  /** Skips to the earliest due time and applies what is due. False if nothing is scheduled. */
  advance(): boolean;
  /** Records an invocation's final output on the EXECUTION operation. */
  complete(output: DurableExecutionOutput): void;
}

export function createInMemoryService(
  options?: InMemoryServiceOptions,
): InMemoryService;
