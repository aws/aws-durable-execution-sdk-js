import { defaultLogger } from "../../logger";
import { WorkerApiRequestMessage } from "./worker-api-request";
import {
  WorkerApiResponseMapping,
  WorkerApiResponse,
} from "./worker-api-response";
import { ApiType } from "./worker-api-types";
import {
  WorkerApiMap,
  ApiCallHandler,
} from "../../test-runner/local/worker/worker-client-api-handler";
import {
  processCompleteInvocation,
  processStartDurableExecution,
  processStartInvocation,
} from "../handlers/execution-handlers";
import { ExecutionManager } from "../storage/execution-manager";
import {
  processCheckpointDurableExecution,
  processPollCheckpointData,
  processUpdateCheckpointData,
} from "../handlers/checkpoint-handlers";
import { processGetDurableExecutionState } from "../handlers/state-handlers";
import {
  processCallbackFailure,
  processCallbackHeartbeat,
  processCallbackSuccess,
} from "../handlers/callbacks";

export class WorkerServerApiHandler {
  private readonly workerApiMap: WorkerApiMap = {
    [ApiType.StartDurableExecution]: new Map(),
    [ApiType.StartInvocation]: new Map(),
    [ApiType.CompleteInvocation]: new Map(),
    [ApiType.UpdateCheckpointData]: new Map(),
    [ApiType.PollCheckpointData]: new Map(),
    [ApiType.GetDurableExecutionState]: new Map(),
    [ApiType.CheckpointDurableExecutionState]: new Map(),
    [ApiType.SendDurableExecutionCallbackSuccess]: new Map(),
    [ApiType.SendDurableExecutionCallbackFailure]: new Map(),
    [ApiType.SendDurableExecutionCallbackHeartbeat]: new Map(),
  };

  private readonly executionManager = new ExecutionManager();

  handleApiCallResponse(apiResponse: WorkerApiResponse<ApiType>) {
    const apiMap = this.workerApiMap[apiResponse.type];
    const handler = apiMap.get(apiResponse.requestId);
    if (!handler) {
      defaultLogger.warn(
        `Could not find API handler for ${apiResponse.type} request with ID ${apiResponse.requestId}`,
      );
      return;
    }

    apiMap.delete(apiResponse.requestId);

    if ("error" in apiResponse) {
      const error = new Error();
      Object.assign(error, apiResponse.error);

      handler.reject(error);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    (handler as ApiCallHandler<WorkerApiResponseMapping[ApiType]>).resolve(
      apiResponse.response,
    );
  }

  performApiCall(data: WorkerApiRequestMessage) {
    switch (data.type) {
      case ApiType.StartDurableExecution:
        return processStartDurableExecution(
          data.params.payload,
          this.executionManager,
        );
      case ApiType.StartInvocation:
        return processStartInvocation(
          data.params.executionId,
          this.executionManager,
        );
      case ApiType.CompleteInvocation:
        return processCompleteInvocation(
          data.params.executionId,
          data.params.invocationId,
          data.params.error,
          this.executionManager,
        );
      case ApiType.UpdateCheckpointData:
        return processUpdateCheckpointData(
          data.params.executionId,
          data.params.operationId,
          data.params.operationData,
          data.params.payload,
          data.params.error,
          this.executionManager,
        );
      case ApiType.PollCheckpointData:
        return processPollCheckpointData(
          data.params.executionId,
          this.executionManager,
        );
      case ApiType.GetDurableExecutionState:
        return processGetDurableExecutionState(
          data.params.DurableExecutionArn,
          this.executionManager,
        );
      case ApiType.CheckpointDurableExecutionState:
        return processCheckpointDurableExecution(
          data.params.DurableExecutionArn,
          data.params,
          this.executionManager,
        );
      case ApiType.SendDurableExecutionCallbackSuccess:
        return processCallbackSuccess(
          // todo: handle undefined instead of disabling eslint rule
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          data.params.CallbackId!,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          Buffer.from(data.params.Result!),
          this.executionManager,
        );
      case ApiType.SendDurableExecutionCallbackFailure:
        return processCallbackFailure(
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          data.params.CallbackId!,
          data.params.Error,
          this.executionManager,
        );
      case ApiType.SendDurableExecutionCallbackHeartbeat:
        return processCallbackHeartbeat(
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          data.params.CallbackId!,
          this.executionManager,
        );
      default:
        data satisfies never;
        throw new Error("Unexpected data ApiType");
    }
  }
}
