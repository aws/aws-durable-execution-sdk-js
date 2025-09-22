import { OperationType } from "@aws-sdk/client-lambda";
import { IndexedOperations } from "./indexed-operations";
import {
  OperationEvents,
  OperationWithData,
} from "./operations/operation-with-data";
import { OperationWaitManager } from "../local/operations/operation-wait-manager";

export class OperationStorage {
  constructor(
    private readonly waitManager: OperationWaitManager,
    protected readonly indexedOperations: IndexedOperations
  ) {}

  getOperations(): OperationWithData[] {
    return (
      this.indexedOperations
        .getOperations()
        .map((data) => {
          const operation = new OperationWithData(
            this.waitManager,
            this.indexedOperations
          );
          operation.populateData(data);
          return operation;
        })
        // TODO: should we even add execution operations to the storage?
        .filter((operation) => operation.getType() !== OperationType.EXECUTION)
    );
  }

  populateOperations(newCheckpointOperations: OperationEvents[]): void {
    this.indexedOperations.addOperations(newCheckpointOperations);
  }
}
