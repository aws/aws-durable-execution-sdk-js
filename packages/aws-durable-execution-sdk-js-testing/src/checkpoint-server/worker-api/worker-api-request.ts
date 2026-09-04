import {
  SendDurableExecutionCallbackFailureRequest,
  SendDurableExecutionCallbackHeartbeatRequest,
  SendDurableExecutionCallbackSuccessRequest,
} from "@aws-sdk/client-lambda";
import {
  CheckpointDurableExecutionRequest,
  ErrorObject,
  GetDurableExecutionStateRequest,
  Operation,
} from "@aws/durable-execution-sdk-js";
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
  // Typed against the SDK's own protocol shapes rather than the AWS client's command
  // inputs. Nothing here calls Lambda -- this is the message channel into the simulated
  // backend, and what arrives on it is whatever the SDK chose to send. Using the command
  // inputs would tie the simulator to the *published* service model, which lags the SDK
  // whenever a new operation type is rolling out; see `pending-fetch-events.ts`.
  [ApiType.GetDurableExecutionState]: GetDurableExecutionStateRequest;
  [ApiType.CheckpointDurableExecutionState]: CheckpointDurableExecutionRequest;
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
