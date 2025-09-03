import { MockOperation } from "./mock-operation";
import { IndexedOperations } from "../../common/indexed-operations";
import { CheckpointOperation } from "../../../checkpoint-server/storage/checkpoint-manager";
import { ExecutionId } from "../../../checkpoint-server/utils/tagged-strings";
import { OperationWithData } from "../../common/operations/operation-with-data";
import { OperationType } from "@amzn/dex-internal-sdk";
import { DurableOperation } from "../../durable-test-runner";
import { OperationWaitManager } from "./operation-wait-manager";

export class OperationStorage {
  private readonly mockOperations: MockOperation[] = [];

  constructor(
    private readonly waitManager: OperationWaitManager,
    private readonly indexedOperations: IndexedOperations,
    private readonly onCheckpointReceived: (
      checkpointOperationsReceived: CheckpointOperation[],
      trackedDurableOperations: DurableOperation<unknown>[]
    ) => void
  ) {}

  private populateMockOperation(mockOperation: MockOperation): boolean {
    // Strategy pattern for population
    const strategies = [
      () =>
        mockOperation._mockId !== undefined
          ? this.indexedOperations.getById(mockOperation._mockId)
          : null,
      () =>
        mockOperation._mockName !== undefined
          ? this.indexedOperations.getByNameAndIndex(
              mockOperation._mockName,
              mockOperation._mockIndex
            )
          : null,
      () =>
        mockOperation._mockIndex !== undefined
          ? this.indexedOperations.getByIndex(mockOperation._mockIndex)
          : null,
    ];

    for (const strategy of strategies) {
      const data = strategy();
      if (data) {
        mockOperation.populateData(data);
        return true; // Indicates operation was populated
      }
    }
    return false; // No data found
  }

  getCompletedOperations(): OperationWithData[] {
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

  registerMocks(executionId: ExecutionId) {
    for (const mockOperation of this.mockOperations) {
      mockOperation.registerMocks(executionId);
    }
  }

  /**
   * Will be run every time checkpoint data is received.
   * @param newCheckpointOperations
   */
  populateOperations(newCheckpointOperations: CheckpointOperation[]): void {
    if (!newCheckpointOperations.length) {
      return;
    }

    this.indexedOperations.addOperations(newCheckpointOperations);

    // Track which operations actually got populated
    const trackedOperations: DurableOperation<unknown>[] = [];

    for (const mockOperation of this.mockOperations) {
      const wasPopulated = this.populateMockOperation(mockOperation);
      if (wasPopulated) {
        trackedOperations.push(mockOperation);
      }
    }

    // Notify via callback
    this.onCheckpointReceived(newCheckpointOperations, trackedOperations);
  }

  registerOperation(operation: MockOperation) {
    this.mockOperations.push(operation);
    this.populateMockOperation(operation);
  }
}
