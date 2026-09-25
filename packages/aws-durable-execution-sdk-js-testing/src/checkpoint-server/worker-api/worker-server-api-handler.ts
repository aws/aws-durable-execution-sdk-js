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
  /**
   * Answer an execution's nth checkpoint call, and only that one, without a
   * `CheckpointToken`. 1 withholds it from the first call.
   */
  withholdCheckpointTokenOnCall?: number;
}

export class WorkerServerApiHandler {
  private readonly executionManager = new ExecutionManager();
  private readonly checkpointDelaySettings: number | undefined;
  private readonly withholdCheckpointTokenOnCall: number | undefined;
  /**
   * Checkpoint calls seen per execution ARN.
   *
   * Per execution rather than per handler: a checkpoint token belongs to one execution's
   * invocation, and nested runners put several executions through this one handler. The
   * count carries across an execution's invocations, which is what leaves the invocation
   * after a withheld token free to finish.
   */
  private readonly checkpointCallCounts = new Map<string, number>();

  constructor(params?: WorkerServerApiHandlerParams) {
    this.checkpointDelaySettings = params?.checkpointDelaySettings;
    this.withholdCheckpointTokenOnCall = params?.withholdCheckpointTokenOnCall;
  }

  /**
   * Whether this execution's next checkpoint response should omit its token, counting the
   * call as it asks.
   */
  private shouldWithholdCheckpointToken(
    durableExecutionArn: string | undefined,
  ): boolean {
    if (this.withholdCheckpointTokenOnCall === undefined) {
      return false;
    }

    const key = durableExecutionArn ?? "";
    const callNumber = (this.checkpointCallCounts.get(key) ?? 0) + 1;
    this.checkpointCallCounts.set(key, callNumber);

    // That one call and no other. Withholding from every later call as well would suspend
    // each replacement invocation as soon as it checkpointed, and the execution would never
    // get anywhere.
    return callNumber === this.withholdCheckpointTokenOnCall;
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
        // Counted before the delay timer, so the count follows the order the calls arrived
        // in rather than the order their timers fire.
        const withholdCheckpointToken = this.shouldWithholdCheckpointToken(
          data.params.DurableExecutionArn,
        );

        return new Promise<CheckpointDurableExecutionResponse>(
          (resolve, reject) => {
            setTimeout(() => {
              try {
                resolve(
                  processCheckpointDurableExecution(
                    data.params.DurableExecutionArn,
                    data.params,
                    this.executionManager,
                    withholdCheckpointToken,
                  ),
                );
              } catch (err: unknown) {
                // `err` is `unknown`, so this rejects with a possibly-non-Error value
                // deliberately: the caller re-throws it as-is and wrapping it here
                // would lose the original. Carried an explicit
                // `@typescript-eslint/prefer-promise-reject-errors` disable before the
                // Biome migration -- that rule has no Biome equivalent at any severity
                // (see biome.jsonc gap 1), so this is a note, not a suppression. It is
                // the only reviewed `prefer-promise-reject-errors` site in the tree; the
                // other no-equivalent rules from that set carry their own inline notes.
                reject(err);
              }
            }, this.checkpointDelaySettings);
          },
        );
      }
      case ApiType.SendDurableExecutionCallbackSuccess:
        return processCallbackSuccess(
          // todo: handle undefined rather than asserting non-null here
          // biome-ignore lint/style/noNonNullAssertion: CallbackId is required on every callback API request by the wire contract, so this assertion holds; it was a reviewed `@typescript-eslint/no-non-null-assertion` disable before the migration and keeps that record until the todo above replaces it with explicit undefined handling.
          data.params.CallbackId!,
          data.params.Result === undefined
            ? Buffer.of()
            : Buffer.from(data.params.Result),
          this.executionManager,
        );
      case ApiType.SendDurableExecutionCallbackFailure:
        return processCallbackFailure(
          // biome-ignore lint/style/noNonNullAssertion: CallbackId is required on every callback API request by the wire contract; reviewed `@typescript-eslint/no-non-null-assertion` disable before the migration.
          data.params.CallbackId!,
          data.params.Error,
          this.executionManager,
        );
      case ApiType.SendDurableExecutionCallbackHeartbeat:
        return processCallbackHeartbeat(
          // biome-ignore lint/style/noNonNullAssertion: CallbackId is required on every callback API request by the wire contract; reviewed `@typescript-eslint/no-non-null-assertion` disable before the migration.
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
