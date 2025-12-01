import { InvocationType } from "@aws-sdk/client-lambda";
import { DurableApiClient } from "../../common/create-durable-api-client";
import { IndexedOperations } from "../../common/indexed-operations";
import {
  OperationEvents,
  OperationWithData,
} from "../../common/operations/operation-with-data";
import { WaitingOperationStatus } from "../../types/durable-operation";
import { OperationWaitManager } from "../../local/operations/operation-wait-manager";

/**
 * @internal
 */
export class CloudOperation<
  OperationResultValue = unknown,
> extends OperationWithData<OperationResultValue> {
  constructor(
    waitManager: OperationWaitManager,
    operationIndex: IndexedOperations,
    apiClient: DurableApiClient,
    private readonly invocationType: InvocationType,
    checkpointOperationData?: OperationEvents,
  ) {
    super(waitManager, operationIndex, apiClient, checkpointOperationData);
  }

  async waitForData(
    status?: WaitingOperationStatus,
  ): Promise<CloudOperation<OperationResultValue>> {
    if (this.invocationType !== InvocationType.Event) {
      throw new Error(
        `InvocationType.${this.invocationType} cannot wait for operation data. Use InvocationType.Event to wait for operation data.`,
      );
    }

    await super.waitForData(status);
    return this;
  }
}
