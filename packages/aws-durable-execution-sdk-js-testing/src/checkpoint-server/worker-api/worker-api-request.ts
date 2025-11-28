import {
  CheckpointDurableExecutionCommandInput,
  ErrorObject,
  GetDurableExecutionCommandInput,
  Operation,
  SendDurableExecutionCallbackFailureCommandInput,
  SendDurableExecutionCallbackHeartbeatCommandInput,
  SendDurableExecutionCallbackSuccessCommandInput,
} from "@aws-sdk/client-lambda";
import { ExecutionId, InvocationId } from "../utils/tagged-strings";
import { ApiType } from "./worker-api-types";

export interface StartDurableExecutionRequest {
  payload?: string;
}

export interface StartInvocationRequest {
  executionId: ExecutionId;
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
  [ApiType.SendDurableExecutionCallbackSuccess]: SendDurableExecutionCallbackSuccessCommandInput;
  [ApiType.SendDurableExecutionCallbackFailure]: SendDurableExecutionCallbackFailureCommandInput;
  [ApiType.SendDurableExecutionCallbackHeartbeat]: SendDurableExecutionCallbackHeartbeatCommandInput;
}

export interface WorkerApiRequest<TApiType extends ApiType> {
  type: TApiType;
  params: WorkerApiRequestMapping[TApiType];
  requestId: string;
}
