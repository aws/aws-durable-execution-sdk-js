// Types for @aws/durable-execution-sdk-js-lite-testing. Keep in sync with src/*.js.

// A relative path, because the lite SDK is not linked into the workspace node_modules.
import type {
  DurableExecutionClient,
  DurableExecutionOutput,
  ErrorObject,
} from "../../aws-durable-execution-sdk-js-lite/src/index.js";

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

/**
 * Functions that ctx.invoke can call, by function name. traceHeader is the
 * ChainedInvokeOptions.XAmznTraceId of the START, set by a plugin's traceHeader hook.
 */
export type InvokeFunctions = Record<
  string,
  (args: { input: unknown; traceHeader: string | undefined }) => unknown
>;

export interface InMemoryServiceOptions {
  /** The user event. Stored as ExecutionDetails.InputPayload. */
  input?: unknown;
  onCallback?: OnCallback;
  functions?: InvokeFunctions;
  /** Serve the state in pages of this size, to exercise pagination. */
  pageSize?: number;
}

/** The handler that withDurableExecution returns. */
export type DurableLambdaHandler = (
  event: InvocationInput,
  lambdaContext: {
    awsRequestId: string;
    getRemainingTimeInMillis(): number;
  },
) => Promise<DurableExecutionOutput>;

export interface RunDurableOptions extends InMemoryServiceOptions {
  /**
   * Returns the handler, built with this client:
   * `(client) => withDurableExecution(workflow, { client, plugins })`.
   * runDurable calls it once.
   */
  createHandler: (client: DurableExecutionClient) => DurableLambdaHandler;
  /** Default 100. */
  maxInvocations?: number;
  /**
   * An existing in-memory service. Pass one to call advanceBy() or boundary() during an
   * invocation. The service options above are then ignored.
   */
  service?: InMemoryService;
}

export interface RunDurableResult<R> {
  /** PENDING means the execution is stuck, for example on an unanswered callback. */
  status: "SUCCEEDED" | "FAILED" | "PENDING";
  result?: R;
  error?: ErrorObject;
  /** Every operation in start order. Deep copies. */
  operations: Operation[];
  invocations: number;
  /**
   * The invocation errors the service would record, in order: each error the handler
   * threw, and an Error for each PENDING output while no operation was pending. The
   * runner invokes again after each.
   */
  invocationErrors: Error[];
  /** The first operation with this Name. */
  getOperation(name: string): Operation | undefined;
}

export function runDurable<R = unknown>(
  options: RunDurableOptions,
): Promise<RunDurableResult<R>>;

/**
 * A `functions` entry that runs a durable function as a new execution with runDurable.
 * A SUCCEEDED child returns its result. A FAILED or PENDING child fails the invoke.
 */
export function durableFunction(
  createHandler: RunDurableOptions["createHandler"],
  options?: Omit<RunDurableOptions, "createHandler" | "input">,
): InvokeFunctions[string];

export interface InvocationInput {
  DurableExecutionArn: string;
  CheckpointToken: string;
  InitialExecutionState: { Operations?: Operation[]; NextMarker?: string };
  /** The ids of the records that changed after the last checkpoint response. */
  UpdatedOperationIds: string[];
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
  /**
   * Applies callback answers and invoke results. Resolves to how many it applied.
   * Callable during an invocation, like advanceBy().
   */
  boundary(): Promise<number>;
  /** Skips to the earliest due time and applies what is due. False if nothing is scheduled. */
  advance(): boolean;
  /**
   * Moves the clock forward and applies what is due. Callable during an invocation: the
   * next checkpoint response then includes the changed records.
   */
  advanceBy(seconds: number): void;
  /** True if a wait, callback, invoke or step retry still waits for the service. */
  hasPending(): boolean;
  /** Records an invocation's final output on the EXECUTION operation. */
  complete(output: DurableExecutionOutput): void;
}

export function createInMemoryService(
  options?: InMemoryServiceOptions,
): InMemoryService;
