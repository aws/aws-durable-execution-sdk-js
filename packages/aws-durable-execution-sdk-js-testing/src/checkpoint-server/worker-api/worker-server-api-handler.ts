import { WorkerApiRequestMessage } from "./worker-api-request";
import { ApiType } from "./worker-api-types";
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
import { CheckpointDurableExecutionResponse } from "@aws-sdk/client-lambda";

export interface WorkerServerApiHandlerParams {
  checkpointDelaySettings?: number;
}

export class WorkerServerApiHandler {
  private readonly executionManager = new ExecutionManager();
  private readonly checkpointDelaySettings: number | undefined;

  constructor(params?: WorkerServerApiHandlerParams) {
    this.checkpointDelaySettings = params?.checkpointDelaySettings;
  }

  performApiCall(data: WorkerApiRequestMessage) {
    switch (data.type) {
      case ApiType.StartDurableExecution:
        return processStartDurableExecution(data.params, this.executionManager);
      case ApiType.StartInvocation:
        return processStartInvocation(data.params, this.executionManager);
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
      case ApiType.CheckpointDurableExecutionState: {
        return new Promise<CheckpointDurableExecutionResponse>(
          (resolve, reject) => {
            setTimeout(() => {
              try {
                resolve(
                  processCheckpointDurableExecution(
                    data.params.DurableExecutionArn,
                    data.params,
                    this.executionManager,
                  ),
                );
              } catch (err: unknown) {
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                reject(err);
              }
            }, this.checkpointDelaySettings);
          },
        );
      }
      case ApiType.SendDurableExecutionCallbackSuccess:
        return processCallbackSuccess(
          // todo: handle undefined instead of disabling eslint rule
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          data.params.CallbackId!,
          data.params.Result === undefined
            ? Buffer.of()
            : Buffer.from(data.params.Result),
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
