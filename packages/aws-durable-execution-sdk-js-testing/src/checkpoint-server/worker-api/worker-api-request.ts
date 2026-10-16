import {
  CheckpointDurableExecutionCommandInput,
  GetDurableExecutionCommandInput,
  SendDurableExecutionCallbackFailureRequest,
  SendDurableExecutionCallbackHeartbeatRequest,
  SendDurableExecutionCallbackSuccessRequest,
} from "@aws-sdk/client-lambda";
import { ErrorObject, Operation } from "@aws/durable-execution-sdk-js";
import { ExecutionId, InvocationId } from "../utils/tagged-strings";
import { ApiType } from "./worker-api-types";

export interface StartDurableExecutionRequest {
  payload?: string;
  invocationId: InvocationId;
}

export interface StartInvocationRequest {
  executionId: ExecutionId;
  invocationId: InvocationId;
}

export interface CompleteInvocationRequest {
  executionId: ExecutionId;
  invocationId: InvocationId;
  error: ErrorObject | undefined;
}

export interface UpdateCheckpointDataRequest {
  executionId: ExecutionId;
  operationId: string;
  operationData: Partial<Operation>;
  payload?: string;
  error?: ErrorObject;
}

export interface PollCheckpointDataRequest {
  executionId: ExecutionId;
}

export interface PauseDurableExecutionRequest {
  executionId: ExecutionId;
}

export interface ResumeDurableExecutionRequest {
  executionId: ExecutionId;
}

/**
 * A checkpoint request, plus the time on the test runner's clock when the SDK sent it.
 *
 * With skipTime, the test runner's clock is a fake clock that runs ahead of the worker's
 * real clock. The service starts a wait or retry delay when it receives the checkpoint.
 * So the worker schedules from this timestamp, which keeps every scheduled time on the
 * same clock that the SDK and the test runner read.
 */
export type CheckpointDurableExecutionStateRequest =
  CheckpointDurableExecutionCommandInput & {
    clientTimestampMs?: number;
  };

export interface WorkerApiRequestMapping {
  [ApiType.StartDurableExecution]: StartDurableExecutionRequest;
  [ApiType.StartInvocation]: StartInvocationRequest;
  [ApiType.CompleteInvocation]: CompleteInvocationRequest;
  [ApiType.UpdateCheckpointData]: UpdateCheckpointDataRequest;
  [ApiType.PollCheckpointData]: PollCheckpointDataRequest;
  [ApiType.DrainCheckpointData]: PollCheckpointDataRequest;
  [ApiType.GetDurableExecutionState]: GetDurableExecutionCommandInput;
  [ApiType.CheckpointDurableExecutionState]: CheckpointDurableExecutionStateRequest;
  [ApiType.SendDurableExecutionCallbackSuccess]: SendDurableExecutionCallbackSuccessRequest;
  [ApiType.SendDurableExecutionCallbackFailure]: SendDurableExecutionCallbackFailureRequest;
  [ApiType.SendDurableExecutionCallbackHeartbeat]: SendDurableExecutionCallbackHeartbeatRequest;
  [ApiType.PauseDurableExecution]: PauseDurableExecutionRequest;
  [ApiType.ResumeDurableExecution]: ResumeDurableExecutionRequest;
}

export interface WorkerApiRequest<TApiType extends ApiType> {
  type: TApiType;
  params: WorkerApiRequestMapping[TApiType];
  requestId: string;
}

export type WorkerApiRequestMessage =
  | WorkerApiRequest<ApiType.StartDurableExecution>
  | WorkerApiRequest<ApiType.StartInvocation>
  | WorkerApiRequest<ApiType.CompleteInvocation>
  | WorkerApiRequest<ApiType.UpdateCheckpointData>
  | WorkerApiRequest<ApiType.GetDurableExecutionState>
  | WorkerApiRequest<ApiType.PollCheckpointData>
  | WorkerApiRequest<ApiType.DrainCheckpointData>
  | WorkerApiRequest<ApiType.CheckpointDurableExecutionState>
  | WorkerApiRequest<ApiType.SendDurableExecutionCallbackSuccess>
  | WorkerApiRequest<ApiType.SendDurableExecutionCallbackFailure>
  | WorkerApiRequest<ApiType.SendDurableExecutionCallbackHeartbeat>
  | WorkerApiRequest<ApiType.PauseDurableExecution>
  | WorkerApiRequest<ApiType.ResumeDurableExecution>;
