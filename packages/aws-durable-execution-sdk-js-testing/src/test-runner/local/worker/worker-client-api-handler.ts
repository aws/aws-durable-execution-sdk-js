import { Worker } from "node:worker_threads";
import { ApiType } from "../../../checkpoint-server/worker-api/worker-api-types";
import {
  WorkerApiRequest,
  WorkerApiRequestMapping,
} from "../../../checkpoint-server/worker-api/worker-api-request";
import {
  WorkerApiResponse,
  WorkerApiResponseMapping,
} from "../../../checkpoint-server/worker-api/worker-api-response";
import { randomUUID } from "node:crypto";
import { WorkerCommandType } from "../../../checkpoint-server/worker/worker-message-types";
import { defaultLogger } from "../../../logger";

export interface ApiCallHandler<TResult> {
  readonly reject: (err: unknown) => void;
  readonly resolve: (value: TResult) => void;
}

export type WorkerApiMap = {
  readonly [TApiType in keyof WorkerApiResponseMapping]: Map<
    string,
    ApiCallHandler<WorkerApiResponseMapping[TApiType]>
  >;
};

export class WorkerClientApiHandler {
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
      handler.reject(apiResponse.error);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    (handler as ApiCallHandler<WorkerApiResponseMapping[ApiType]>).resolve(
      apiResponse.response,
    );
  }

  async callWorkerApi<TApiType extends ApiType>(
    apiType: TApiType,
    params: WorkerApiRequestMapping[TApiType],
    worker: Worker,
  ) {
    const requestId = randomUUID();

    worker.postMessage({
      type: WorkerCommandType.API_REQUEST,
      data: {
        requestId,
        type: apiType,
        params,
      } satisfies WorkerApiRequest<TApiType>,
    });

    const promise = new Promise<WorkerApiResponseMapping[TApiType]>(
      (resolve, reject) => {
        this.workerApiMap[apiType].set(requestId, {
          reject,
          resolve,
        });
      },
    );

    return promise;
  }
}
