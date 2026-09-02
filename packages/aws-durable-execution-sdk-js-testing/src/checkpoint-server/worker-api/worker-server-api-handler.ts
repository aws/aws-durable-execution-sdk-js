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
import { CheckpointDurableExecutionResponse } from "@aws/durable-execution-sdk-js";

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
                // `err` is `unknown`, so this rejects with a possibly-non-Error value
                // deliberately: the caller re-throws it as-is and wrapping it here
                // would lose the original. Carried an explicit
                // `@typescript-eslint/prefer-promise-reject-errors` disable before the
                // Biome migration -- that rule has no Biome equivalent at any severity
                // (see biome.jsonc gap 1), so this is a note, not a suppression, and it
                // is the only reviewed instance of the pattern in the tree.
                reject(err);
              }
            }, this.checkpointDelaySettings);
          },
        );
      }
      case ApiType.SendDurableExecutionCallbackSuccess:
        return processCallbackSuccess(
          // todo: handle undefined rather than asserting non-null here
          data.params.CallbackId!,
          data.params.Result === undefined
            ? Buffer.of()
            : Buffer.from(data.params.Result),
          this.executionManager,
        );
      case ApiType.SendDurableExecutionCallbackFailure:
        return processCallbackFailure(
          data.params.CallbackId!,
          data.params.Error,
          this.executionManager,
        );
      case ApiType.SendDurableExecutionCallbackHeartbeat:
        return processCallbackHeartbeat(
          data.params.CallbackId!,
          this.executionManager,
        );
      default:
        // biome-ignore lint/suspicious/noUnusedExpressions: GENUINE DIFFERENCE from ESLint, not untriaged noise -- this is a compile-time exhaustiveness assertion, and it has no runtime effect by design. ESLint's no-unused-expressions did not flag `satisfies` expressions; Biome's does.
        data satisfies never;
        throw new Error("Unexpected data ApiType");
    }
  }
}
