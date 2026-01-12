import {
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
  SendDurableExecutionCallbackFailureResponse,
  SendDurableExecutionCallbackHeartbeatResponse,
  SendDurableExecutionCallbackSuccessResponse,
  Event,
} from "@aws-sdk/client-lambda";
import { InvocationResult } from "../storage/execution-manager";
import { ApiType } from "./worker-api-types";
import { CheckpointOperation } from "../storage/checkpoint-manager";

// TODO: move polling logic into worker, and use event-based updates for
// all re-invocations
export interface PollCheckpointDataResponse {
  operations: CheckpointOperation[];
}

export interface CompleteInvocationResponse {
  event: Event;
  hasDirtyOperations: boolean;
}

export interface WorkerApiResponseMapping {
  [ApiType.StartDurableExecution]: InvocationResult;
  [ApiType.StartInvocation]: InvocationResult;
  [ApiType.CompleteInvocation]: CompleteInvocationResponse;
  [ApiType.UpdateCheckpointData]: Record<string, never>;
  [ApiType.PollCheckpointData]: Promise<PollCheckpointDataResponse>;
  [ApiType.GetDurableExecutionState]: GetDurableExecutionStateResponse;
  [ApiType.CheckpointDurableExecutionState]: CheckpointDurableExecutionResponse;
  [ApiType.SendDurableExecutionCallbackSuccess]: SendDurableExecutionCallbackSuccessResponse;
  [ApiType.SendDurableExecutionCallbackFailure]: SendDurableExecutionCallbackFailureResponse;
  [ApiType.SendDurableExecutionCallbackHeartbeat]: SendDurableExecutionCallbackHeartbeatResponse;
}

export type WorkerApiResponse<TApiType extends ApiType> =
  | {
      type: TApiType;
      response: WorkerApiResponseMapping[TApiType];
      requestId: string;
    }
  | {
      type: TApiType;
      error: unknown;
      requestId: string;
    };
