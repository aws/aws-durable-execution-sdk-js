import {
  CheckpointDurableExecutionCommandInput,
  ErrorObject,
  GetDurableExecutionCommandInput,
  Operation,
  SendDurableExecutionCallbackFailureRequest,
  SendDurableExecutionCallbackHeartbeatRequest,
  SendDurableExecutionCallbackSuccessRequest,
} from "@aws-sdk/client-lambda";
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

export interface WorkerApiRequestMapping {
  [ApiType.StartDurableExecution]: StartDurableExecutionRequest;
  [ApiType.StartInvocation]: StartInvocationRequest;
  [ApiType.CompleteInvocation]: CompleteInvocationRequest;
  [ApiType.UpdateCheckpointData]: UpdateCheckpointDataRequest;
  [ApiType.PollCheckpointData]: PollCheckpointDataRequest;
  [ApiType.GetDurableExecutionState]: GetDurableExecutionCommandInput;
  [ApiType.CheckpointDurableExecutionState]: CheckpointDurableExecutionCommandInput;
  [ApiType.SendDurableExecutionCallbackSuccess]: SendDurableExecutionCallbackSuccessRequest;
  [ApiType.SendDurableExecutionCallbackFailure]: SendDurableExecutionCallbackFailureRequest;
  [ApiType.SendDurableExecutionCallbackHeartbeat]: SendDurableExecutionCallbackHeartbeatRequest;
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
  | WorkerApiRequest<ApiType.CheckpointDurableExecutionState>
  | WorkerApiRequest<ApiType.SendDurableExecutionCallbackSuccess>
  | WorkerApiRequest<ApiType.SendDurableExecutionCallbackFailure>
  | WorkerApiRequest<ApiType.SendDurableExecutionCallbackHeartbeat>;
