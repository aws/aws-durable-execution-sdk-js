import {
  OperationType,
  Operation,
  OperationStatus,
  ErrorObject,
  SendDurableExecutionCallbackSuccessCommandOutput,
  SendDurableExecutionCallbackFailureCommandOutput,
  SendDurableExecutionCallbackHeartbeatCommandOutput,
  Event,
} from "@aws-sdk/client-lambda";
import {
  DurableOperation,
  TestResultError,
  WaitingOperationStatus,
} from "../../durable-test-runner";
import { OperationWaitManager } from "../../local/operations/operation-wait-manager";
import { doesStatusMatch } from "../../local/operations/status-matcher";
import { tryJsonParse } from "../utils";
import { IndexedOperations } from "../indexed-operations";
import { transformErrorObjectToErrorResult } from "../../../utils";
import { OperationSubType } from "@aws/durable-execution-sdk-js";
import { DurableApiClient } from "../create-durable-api-client";

export interface OperationResultContextDetails<ResultValue = unknown> {
  readonly result: ResultValue | undefined;
  readonly error: TestResultError | undefined;
}

export interface OperationResultStepDetails<ResultValue = unknown> {
  readonly attempt: number | undefined;
  readonly nextAttemptTimestamp: Date | undefined;
  readonly result: ResultValue | undefined;
  readonly error: TestResultError | undefined;
}

export interface OperationResultCallbackDetails<ResultValue = unknown> {
  readonly callbackId: string;
  readonly error?: TestResultError;
  readonly result?: ResultValue;
}

export interface OperationResultChainedInvokeDetails<ResultValue = unknown> {
  readonly error?: TestResultError;
  readonly result?: ResultValue;
}

export interface WaitResultDetails {
  readonly waitSeconds?: number;
  readonly scheduledEndTimestamp?: Date;
}

export interface OperationEvents {
  operation: Operation;
  events: Event[];
}

export class OperationWithData<OperationResultValue = unknown>
  implements DurableOperation<OperationResultValue>
{
  constructor(
    private readonly waitManager: OperationWaitManager,
    private readonly operationIndex: IndexedOperations,
    private readonly apiClient: DurableApiClient,
    private checkpointOperationData?: OperationEvents | undefined,
  ) {}

  populateData(checkpointOperation: OperationEvents) {
    this.checkpointOperationData = checkpointOperation;
  }

  async waitForData(
    status: WaitingOperationStatus = WaitingOperationStatus.STARTED,
  ): Promise<OperationWithData<OperationResultValue>> {
    if (
      doesStatusMatch(this.checkpointOperationData?.operation.Status, status)
    ) {
      return this;
    }

    await this.waitManager.waitForOperation(this, status);
    return this;
  }

  getContextDetails():
    | OperationResultContextDetails<OperationResultValue>
    | undefined {
    const operationData = this.getOperationData();

    if (!operationData) {
      return undefined;
    }

    if (operationData.Type !== OperationType.CONTEXT) {
      throw new Error(`Operation type ${operationData.Type} is not CONTEXT`);
    }

    const contextDetails = operationData.ContextDetails;

    return {
      result: tryJsonParse(contextDetails?.Result),
      error: transformErrorObjectToErrorResult(contextDetails?.Error),
    };
  }

  getStepDetails():
    | OperationResultStepDetails<OperationResultValue>
    | undefined {
    const operationData = this.getOperationData();

    if (!operationData) {
      return undefined;
    }

    if (operationData.Type !== OperationType.STEP) {
      throw new Error(`Operation type ${operationData.Type} is not STEP`);
    }

    const stepDetails = operationData.StepDetails;

    return {
      attempt: stepDetails?.Attempt,
      nextAttemptTimestamp: stepDetails?.NextAttemptTimestamp,
      result: tryJsonParse(stepDetails?.Result),
      error: transformErrorObjectToErrorResult(stepDetails?.Error),
    };
  }

  private getWaitForCallbackDetails():
    | OperationResultCallbackDetails<OperationResultValue>
    | undefined {
    const createCallbackOperation = this.getChildOperations()
      ?.find((operation) => operation.getType() === OperationType.CALLBACK)
      ?.getOperationData();

    if (!createCallbackOperation) {
      throw new Error(
        "Could not find CALLBACK operation in WAIT_FOR_CALLBACK context",
      );
    }

    return this.getCreateCallbackDetails(createCallbackOperation);
  }

  private getCreateCallbackDetails(
    operationData: Operation,
  ): OperationResultCallbackDetails<OperationResultValue> | undefined {
    const callbackDetails = operationData.CallbackDetails;
    if (callbackDetails?.CallbackId === undefined) {
      throw new Error("Could not find callback ID in callback details");
    }

    return {
      callbackId: callbackDetails.CallbackId,
      error: transformErrorObjectToErrorResult(callbackDetails.Error),
      result: tryJsonParse(callbackDetails.Result),
    };
  }

  getChainedInvokeDetails():
    | OperationResultChainedInvokeDetails<OperationResultValue>
    | undefined {
    const operationData = this.getOperationData();

    if (!operationData) {
      return undefined;
    }

    if (operationData.Type !== OperationType.CHAINED_INVOKE) {
      throw new Error(`Operation type ${operationData.Type} is not INVOKE`);
    }

    const invokeDetails = operationData.ChainedInvokeDetails;

    let result: OperationResultValue | undefined;
    try {
      result = invokeDetails?.Result
        ? // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          (JSON.parse(invokeDetails.Result) as unknown as OperationResultValue)
        : undefined;
    } catch (err) {
      throw new Error("Could not parse result for invoke details", {
        cause: err,
      });
    }

    return {
      error: transformErrorObjectToErrorResult(invokeDetails?.Error),
      result,
    };
  }

  getCallbackDetails():
    | OperationResultCallbackDetails<OperationResultValue>
    | undefined {
    const operationData = this.getOperationData();

    if (!operationData) {
      return undefined;
    }

    if (operationData.Type === OperationType.CALLBACK) {
      return this.getCreateCallbackDetails(operationData);
    }

    if (
      operationData.Type === OperationType.CONTEXT &&
      operationData.SubType === OperationSubType.WAIT_FOR_CALLBACK
    ) {
      return this.getWaitForCallbackDetails();
    }

    throw new Error(
      `Operation with Type ${operationData.Type} and SubType ${operationData.SubType} is not a valid callback`,
    );
  }

  getWaitDetails(): WaitResultDetails | undefined {
    const operationData = this.getOperationData();

    if (!operationData) {
      return undefined;
    }

    if (operationData.Type !== OperationType.WAIT) {
      throw new Error(`Operation type ${operationData.Type} is not WAIT`);
    }

    const details = this.checkpointOperationData?.events[0]?.WaitStartedDetails;
    if (!details) {
      throw new Error("First wait event does not have WaitStartedDetails");
    }

    return {
      waitSeconds: details.Duration,
      // TODO: fix serialization of dates in API responses
      scheduledEndTimestamp:
        details.ScheduledEndTimestamp !== undefined
          ? new Date(details.ScheduledEndTimestamp)
          : undefined,
    };
  }

  getChildOperations(): OperationWithData[] | undefined {
    const result = this.getOperationData();
    if (!result) {
      return undefined;
    }

    if (!result.Id) {
      throw new Error("Could not find operation ID");
    }

    const checkpointOperations = this.operationIndex.getOperationChildren(
      result.Id,
    );

    return checkpointOperations.map(
      (checkpointOperation) =>
        new OperationWithData(
          this.waitManager,
          this.operationIndex,
          this.apiClient,
          checkpointOperation,
        ),
    );
  }

  // TODO: need subtypes to properly get operations by path for map/parallel
  // getChildOperationByPath(path: (string | number)[]): EnhancedOperationData;

  getOperationData(): Operation | undefined {
    return this.checkpointOperationData?.operation;
  }

  getEvents(): Event[] | undefined {
    return this.checkpointOperationData?.events;
  }

  getId(): string | undefined {
    return this.checkpointOperationData?.operation.Id;
  }

  getParentId(): string | undefined {
    return this.checkpointOperationData?.operation.ParentId;
  }

  getName(): string | undefined {
    return this.checkpointOperationData?.operation.Name;
  }

  getType(): OperationType | undefined {
    return this.checkpointOperationData?.operation.Type;
  }

  getSubType(): OperationSubType | undefined {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return this.checkpointOperationData?.operation.SubType as OperationSubType;
  }

  isWaitForCallback(): boolean {
    return (
      this.getType() === OperationType.CONTEXT &&
      this.getSubType() === OperationSubType.WAIT_FOR_CALLBACK
    );
  }

  isCallback(): boolean {
    return this.getType() === OperationType.CALLBACK;
  }

  getStatus(): OperationStatus | undefined {
    return this.checkpointOperationData?.operation.Status;
  }

  getStartTimestamp(): Date | undefined {
    // TODO: remove this when the local runner converts to Date correctly
    if (
      typeof this.checkpointOperationData?.operation.StartTimestamp === "number"
    ) {
      return new Date(
        this.checkpointOperationData.operation.StartTimestamp * 1000,
      );
    }
    return this.checkpointOperationData?.operation.StartTimestamp;
  }

  getEndTimestamp(): Date | undefined {
    // TODO: remove this when the local runner converts to Date correctly
    if (
      typeof this.checkpointOperationData?.operation.EndTimestamp === "number"
    ) {
      return new Date(
        this.checkpointOperationData.operation.EndTimestamp * 1000,
      );
    }
    return this.checkpointOperationData?.operation.EndTimestamp;
  }

  sendCallbackSuccess(
    result: string,
  ): Promise<SendDurableExecutionCallbackSuccessCommandOutput> {
    const callbackDetails = this.getCallbackDetails();

    if (!callbackDetails) {
      throw new Error("Could not find callback details");
    }

    return this.apiClient.sendCallbackSuccess({
      Result: result,
      CallbackId: callbackDetails.callbackId,
    });
  }

  sendCallbackFailure(
    error: ErrorObject,
  ): Promise<SendDurableExecutionCallbackFailureCommandOutput> {
    const callbackDetails = this.getCallbackDetails();

    if (!callbackDetails) {
      throw new Error("Could not find callback details");
    }
    return this.apiClient.sendCallbackFailure({
      Error: error,
      CallbackId: callbackDetails.callbackId,
    });
  }

  sendCallbackHeartbeat(): Promise<SendDurableExecutionCallbackHeartbeatCommandOutput> {
    const callbackDetails = this.getCallbackDetails();

    if (!callbackDetails) {
      throw new Error("Could not find callback details");
    }

    return this.apiClient.sendCallbackHeartbeat({
      CallbackId: callbackDetails.callbackId,
    });
  }
}
