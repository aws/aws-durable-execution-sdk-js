import { Context } from "aws-lambda";
import { TerminationManager } from "../termination-manager/termination-manager";
import { ExecutionState } from "../storage/storage-provider";
import { Serdes } from "../utils/serdes/serdes";

import { ErrorObject, Operation } from "@aws-sdk/client-lambda";

// Define BatchItemStatus enum
export enum BatchItemStatus {
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  STARTED = "STARTED",
}

// Import types for concurrent execution
import type {
  ConcurrentExecutionItem,
  ConcurrentExecutor,
  ConcurrencyConfig,
} from "../handlers/concurrent-execution-handler/concurrent-execution-handler";

// Import BatchResult types
import type {
  BatchResult,
  BatchItem,
} from "../handlers/concurrent-execution-handler/batch-result";

export interface LambdaHandler<T> {
  (event: T, context: Context): Promise<DurableExecutionInvocationOutput>;
}

// TODO - prefer to import this entire input model from the SDK,
// but it's not part of the frontend model so it doesn't get generated.
export interface DurableExecutionInvocationInput {
  DurableExecutionArn: string;
  CheckpointToken: string;
  InitialExecutionState: {
    Operations: Operation[];
    NextMarker: string;
  };
  LoggingMode?: string;

  /**
   * Flag to indicate if this execution is running against local runner.
   */
  LocalRunner?: boolean;
}

export enum InvocationStatus {
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  PENDING = "PENDING",
}

export enum OperationSubType {
  STEP = "Step",
  WAIT = "Wait",
  CALLBACK = "Callback",
  RUN_IN_CHILD_CONTEXT = "RunInChildContext",
  MAP = "Map",
  MAP_ITERATION = "MapIteration",
  PARALLEL = "Parallel",
  PARALLEL_BRANCH = "ParallelBranch",
  WAIT_FOR_CALLBACK = "WaitForCallback",
  WAIT_FOR_CONDITION = "WaitForCondition",
  INVOKE = "Invoke",
}

interface DurableExecutionInvocationOutputFailed {
  Status: InvocationStatus.FAILED;
  Error: ErrorObject;
}

interface DurableExecutionInvocationOutputSucceeded {
  Status: InvocationStatus.SUCCEEDED;
  Result?: string;
}

interface DurableExecutionInvocationOutputPending {
  Status: InvocationStatus.PENDING;
}

export type DurableExecutionInvocationOutput =
  | DurableExecutionInvocationOutputSucceeded
  | DurableExecutionInvocationOutputFailed
  | DurableExecutionInvocationOutputPending;

export interface DurableContext extends Context {
  _stepPrefix?: string;
  _stepCounter: number;
  step: <T>(
    nameOrFn: string | undefined | StepFunc<T>,
    fnOrOptions?: StepFunc<T> | StepConfig<T>,
    maybeOptions?: StepConfig<T>,
  ) => Promise<T>;
  invoke: <I, O>(
    nameOrFuncId: string,
    funcIdOrInput?: string | I,
    inputOrConfig?: I | InvokeConfig,
    maybeConfig?: InvokeConfig,
  ) => Promise<O>;
  runInChildContext: <T>(
    nameOrFn: string | undefined | ChildFunc<T>,
    fnOrOptions?: ChildFunc<T> | ChildConfig<T>,
    maybeOptions?: ChildConfig<T>,
  ) => Promise<T>;
  wait: {
    (name: string, millis: number): Promise<void>;
    (millis: number): Promise<void>;
  };
  waitForCondition: <T>(
    nameOrCheck: string | undefined | WaitForConditionCheckFunc<T>,
    checkOrConfig?: WaitForConditionCheckFunc<T> | WaitForConditionConfig<T>,
    maybeConfig?: WaitForConditionConfig<T>,
  ) => Promise<T>;
  createCallback: <T>(
    nameOrConfig?: string | undefined | CreateCallbackConfig,
    maybeConfig?: CreateCallbackConfig,
  ) => Promise<CreateCallbackResult<T>>;
  waitForCallback: <T>(
    nameOrSubmitter?: string | undefined | WaitForCallbackSubmitterFunc,
    submitterOrConfig?: WaitForCallbackSubmitterFunc | WaitForCallbackConfig,
    maybeConfig?: WaitForCallbackConfig,
  ) => Promise<T>;
  map: <T>(
    nameOrItems: string | undefined | any[],
    itemsOrMapFunc?: any[] | MapFunc<T>,
    mapFuncOrConfig?: MapFunc<T> | MapConfig,
    maybeConfig?: MapConfig,
  ) => Promise<BatchResult<T>>;
  parallel: <T>(
    nameOrBranches: string | undefined | ParallelFunc<T>[],
    branchesOrConfig?: ParallelFunc<T>[] | ParallelConfig,
    maybeConfig?: ParallelConfig,
  ) => Promise<BatchResult<T>>;
  promise: {
    all: <T>(
      nameOrPromises: string | undefined | Promise<T>[],
      maybePromises?: Promise<T>[],
    ) => Promise<T[]>;
    allSettled: <T>(
      nameOrPromises: string | undefined | Promise<T>[],
      maybePromises?: Promise<T>[],
    ) => Promise<PromiseSettledResult<T>[]>;
    any: <T>(
      nameOrPromises: string | undefined | Promise<T>[],
      maybePromises?: Promise<T>[],
    ) => Promise<T>;
    race: <T>(
      nameOrPromises: string | undefined | Promise<T>[],
      maybePromises?: Promise<T>[],
    ) => Promise<T>;
  };
  executeConcurrently: <TItem, TResult>(
    nameOrItems: string | undefined | ConcurrentExecutionItem<TItem>[],
    itemsOrExecutor?:
      | ConcurrentExecutionItem<TItem>[]
      | ConcurrentExecutor<TItem, TResult>,
    executorOrConfig?: ConcurrentExecutor<TItem, TResult> | ConcurrencyConfig,
    maybeConfig?: ConcurrencyConfig,
  ) => Promise<BatchResult<TResult>>;
  setCustomLogger: (logger: Logger) => void;
}

export interface ExecutionContext {
  executionContextId: string;
  customerHandlerEvent: any;
  state: ExecutionState;
  _stepData: Record<string, Operation>; // Private, use getStepData() instead
  terminationManager: TerminationManager;
  isLocalMode: boolean;
  isVerbose: boolean;
  durableExecutionArn: string;
  parentId?: string;
  getStepData(stepId: string): Operation | undefined;
}

export type RetryDecision =
  | { shouldRetry: true; delaySeconds: number }
  | { shouldRetry: false };

export enum StepSemantics {
  AtMostOncePerRetry = "AT_MOST_ONCE_PER_RETRY",
  AtLeastOncePerRetry = "AT_LEAST_ONCE_PER_RETRY",
}

export interface StepConfig<T> {
  retryStrategy?: (error: Error, attemptCount: number) => RetryDecision;
  semantics?: StepSemantics;
  serdes?: Serdes<T>;
}

export interface ChildConfig<T = any> {
  serdes?: Serdes<T>;
  subType?: string;
  // summaryGenerator will be used internally to create a summary for
  // ctx.map and ctx.parallel when result is big
  summaryGenerator?: (result: T) => string;
}

export interface CreateCallbackConfig {
  timeout?: number; // seconds
  heartbeatTimeout?: number; // seconds
  serdes?: Serdes<any>;
}

export interface WaitForCallbackConfig {
  timeout?: number; // seconds
  heartbeatTimeout?: number; // seconds
  retryStrategy?: (error: Error, attemptCount: number) => RetryDecision;
  serdes?: Serdes<any>;
}

export interface InvokeConfig {
  serdes?: Serdes<any>;
}

export type CreateCallbackResult<T> = [Promise<T>, string]; // [promise, callbackId]
export type WaitForCallbackSubmitterFunc = (
  callbackId: string,
  context: WaitForCallbackContext,
) => Promise<void>;

// Generic logger interface for custom logger implementations
export interface Logger {
  log(level: string, message?: string, data?: any, error?: Error): void;
  error(message?: string, error?: Error, data?: any): void;
  warn(message?: string, data?: any): void;
  info(message?: string, data?: any): void;
  debug(message?: string, data?: any): void;
}

/**
 * Base interface for operation contexts.
 * Do not use directly - use specific context types like StepContext, WaitForConditionContext, etc.
 */
export interface OperationContext {
  logger: Logger;
}

export type StepContext = OperationContext;

export type WaitForConditionContext = OperationContext;

export type WaitForCallbackContext = OperationContext;

export type StepFunc<T> = (context: StepContext) => Promise<T>;
export type ChildFunc<T> = (context: DurableContext) => Promise<T>;
export type MapFunc<T> = (
  context: DurableContext,
  item: any,
  index: number,
  array: any[],
) => Promise<T>;
export type ParallelFunc<T> = (context: DurableContext) => Promise<T>;

// Wait for condition types
export type WaitForConditionCheckFunc<T> = (
  state: T,
  context: WaitForConditionContext,
) => Promise<T>;
export type WaitForConditionWaitStrategyFunc<T> = (
  state: T,
  attempt: number,
) => WaitForConditionDecision;

export type WaitForConditionDecision =
  | { shouldContinue: true; delaySeconds: number }
  | { shouldContinue: false };

export interface WaitForConditionConfig<T> {
  waitStrategy: WaitForConditionWaitStrategyFunc<T>;
  initialState: T;
  serdes?: Serdes<T>;
}

export interface MapConfig {
  maxConcurrency?: number;
  completionConfig?: {
    minSuccessful?: number;
    toleratedFailureCount?: number;
    toleratedFailurePercentage?: number;
  };
}

export interface ParallelConfig {
  maxConcurrency?: number;
  completionConfig?: {
    minSuccessful?: number;
    toleratedFailureCount?: number;
    toleratedFailurePercentage?: number;
  };
}

// Re-export concurrent execution types for public API
export type {
  ConcurrentExecutionItem,
  ConcurrentExecutor,
  ConcurrencyConfig,
} from "../handlers/concurrent-execution-handler/concurrent-execution-handler";

// Re-export BatchResult types for public API
export type {
  BatchResult,
  BatchItem,
} from "../handlers/concurrent-execution-handler/batch-result";
