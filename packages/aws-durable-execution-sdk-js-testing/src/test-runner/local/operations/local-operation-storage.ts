import { MockOperation } from "./mock-operation";
import { IndexedOperations } from "../../common/indexed-operations";
import { ExecutionId } from "../../../checkpoint-server/utils/tagged-strings";
import { OperationEvents } from "../../common/operations/operation-with-data";
import { DurableOperation } from "../../durable-test-runner";
import { OperationWaitManager } from "./operation-wait-manager";
import { OperationStorage } from "../../common/operation-storage";
import { Event } from "@aws-sdk/client-lambda";

export class LocalOperationStorage extends OperationStorage {
  private readonly mockOperations: MockOperation[] = [];
  private readonly events: Event[] = [];

  constructor(
    waitManager: OperationWaitManager,
    indexedOperations: IndexedOperations,
    private readonly onCheckpointReceived: (
      checkpointOperationsReceived: OperationEvents[],
      trackedDurableOperations: DurableOperation<unknown>[]
    ) => void
  ) {
    super(waitManager, indexedOperations);
    this.events.push(
      ...indexedOperations.getOperations().flatMap((op) => op.events)
    );
  }

  getHistoryEvents(): Event[] {
    return this.events;
  }

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

  registerMocks(executionId: ExecutionId) {
    for (const mockOperation of this.mockOperations) {
      mockOperation.registerMocks(executionId);
    }
  }

  /**
   * Will be run every time checkpoint data is received.
   * @param newCheckpointOperations
   */
  populateOperations(newCheckpointOperations: OperationEvents[]): void {
    if (!newCheckpointOperations.length) {
      return;
    }

    this.indexedOperations.addOperations(newCheckpointOperations);

    // TODO: don't iterate through all history events on each operation update
    this.events.length = 0;
    this.events.push(...this.indexedOperations.getHistoryEvents());

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
