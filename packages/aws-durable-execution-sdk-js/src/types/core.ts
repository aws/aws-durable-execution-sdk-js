import { Context } from "aws-lambda";
import { TerminationManager } from "../termination-manager/termination-manager";
import { ExecutionState } from "../storage/storage";
import { ErrorObject, Operation } from "@aws-sdk/client-lambda";

export enum DurableExecutionMode {
  ExecutionMode = "ExecutionMode",
  ReplayMode = "ReplayMode",
  ReplaySucceededContext = "ReplaySucceededContext",
}

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
  CHAINED_INVOKE = "ChainedInvoke",
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

export type Duration =
  | { days: number; hours?: number; minutes?: number; seconds?: number }
  | { hours: number; minutes?: number; seconds?: number }
  | { minutes: number; seconds?: number }
  | { seconds: number };

export interface ExecutionContext {
  state: ExecutionState;
  _stepData: Record<string, Operation>; // Private, use getStepData() instead
  terminationManager: TerminationManager;
  durableExecutionArn: string;
  getStepData(stepId: string): Operation | undefined;
}
