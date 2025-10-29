import { OperationType } from "@aws-sdk/client-lambda";
import { IndexedOperations } from "./indexed-operations";
import {
  OperationEvents,
  OperationWithData,
} from "./operations/operation-with-data";
import { OperationWaitManager } from "../local/operations/operation-wait-manager";
import { DurableApiClient } from "./create-durable-api-client";

export interface TrackedOperation<Operation extends OperationWithData> {
  operation: Operation;
  params: {
    id?: string;
    index?: number;
    name?: string;
  };
}

export class OperationStorage {
  private readonly trackedOperations: TrackedOperation<OperationWithData>[] =
    [];

  constructor(
    private readonly waitManager: OperationWaitManager,
    protected readonly indexedOperations: IndexedOperations,
    private readonly apiClient: DurableApiClient,
  ) {}

  private populateOperation(
    trackedOperation: TrackedOperation<OperationWithData>,
  ) {
    const strategies = [
      () =>
        trackedOperation.params.id !== undefined
          ? this.indexedOperations.getById(trackedOperation.params.id)
          : null,
      () =>
        trackedOperation.params.name !== undefined &&
        trackedOperation.params.id === undefined
          ? this.indexedOperations.getByNameAndIndex(
              trackedOperation.params.name,
              trackedOperation.params.index,
            )
          : null,
      () =>
        trackedOperation.params.index !== undefined &&
        trackedOperation.params.name === undefined &&
        trackedOperation.params.id === undefined
          ? this.indexedOperations.getByIndex(trackedOperation.params.index)
          : null,
    ];

    for (const strategy of strategies) {
      const data = strategy();
      if (data) {
        trackedOperation.operation.populateData(data);
        break;
      }
    }
  }

  getTrackedOperations(): OperationWithData[] {
    return this.trackedOperations.map((op) => op.operation);
  }

  getOperations(): OperationWithData[] {
    return (
      this.indexedOperations
        .getOperations()
        .map((data) => {
          const operation = new OperationWithData(
            this.waitManager,
            this.indexedOperations,
            this.apiClient,
          );
          operation.populateData(data);
          return operation;
        })
        // TODO: should we even add execution operations to the storage?
        .filter((operation) => operation.getType() !== OperationType.EXECUTION)
    );
  }

  registerOperation(trackedOperation: TrackedOperation<OperationWithData>) {
    this.trackedOperations.push(trackedOperation);
    this.populateOperation(trackedOperation);
  }

  populateOperations(newCheckpointOperations: OperationEvents[]): void {
    if (!newCheckpointOperations.length) {
      return;
    }

    this.indexedOperations.addOperations(newCheckpointOperations);
    for (const trackedOperation of this.trackedOperations) {
      this.populateOperation(trackedOperation);
    }
  }
}
