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

export interface WorkerApiRequestMapping {
  [ApiType.StartDurableExecution]: StartDurableExecutionRequest;
  [ApiType.StartInvocation]: StartInvocationRequest;
  [ApiType.CompleteInvocation]: CompleteInvocationRequest;
  [ApiType.UpdateCheckpointData]: UpdateCheckpointDataRequest;
  [ApiType.PollCheckpointData]: PollCheckpointDataRequest;
  [ApiType.DrainCheckpointData]: PollCheckpointDataRequest;
  [ApiType.GetDurableExecutionState]: GetDurableExecutionCommandInput;
  [ApiType.CheckpointDurableExecutionState]: CheckpointDurableExecutionCommandInput;
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
  /**
   * `Date.now()` on the main thread when the request was sent. With skipTime that clock is
   * fake, and the checkpoint server records every timestamp on it. See client-clock.ts.
   */
  clientTimestampMs?: number;
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
