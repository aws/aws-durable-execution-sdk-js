import { MockOperation } from "./mock-operation";
import { IndexedOperations } from "../../common/indexed-operations";
import { ExecutionId } from "../../../checkpoint-server/utils/tagged-strings";
import { OperationEvents } from "../../common/operations/operation-with-data";
import { DurableOperation } from "../../durable-test-runner";
import { OperationWaitManager } from "./operation-wait-manager";
import { OperationStorage } from "../../common/operation-storage";
import { Event } from "@aws-sdk/client-lambda";
import { DurableApiClient } from "../../common/create-durable-api-client";

export class LocalOperationStorage extends OperationStorage<MockOperation> {
  private readonly events: Event[] = [];

  constructor(
    waitManager: OperationWaitManager,
    indexedOperations: IndexedOperations,
    apiClient: DurableApiClient,
    private readonly onCheckpointReceived: (
      checkpointOperationsReceived: OperationEvents[],
      trackedDurableOperations: DurableOperation<unknown>[],
    ) => void,
  ) {
    super(waitManager, indexedOperations, apiClient);
    this.events.push(
      ...indexedOperations.getOperations().flatMap((op) => op.events),
    );
  }

  getHistoryEvents(): Event[] {
    return this.events;
  }

  getOperation(operationId: string) {
    const operationEvents = this.indexedOperations.getById(operationId);
    if (!operationEvents) {
      // Return a minimal operation with required fields
      // Type and Status are undefined because they will be immediately set by the calling code
      // based on the actual operation context (STEP, CALLBACK, EXECUTION, etc.)
      return {
        Id: operationId,
        Type: undefined, // Will be set by calling code based on operation context
        StartTimestamp: new Date(),
        Status: undefined, // Will be set by calling code based on operation state
      };
    }
    return operationEvents.operation;
  }

  registerMocks(executionId: ExecutionId) {
    for (const mockOperation of this.getTrackedOperations()) {
      mockOperation.registerMocks(executionId);
    }
  }

  /**
   * Will be run every time checkpoint data is received.
   * @param newCheckpointOperations
   */
  populateOperations(newCheckpointOperations: OperationEvents[]): void {
    super.populateOperations(newCheckpointOperations);

    if (!newCheckpointOperations.length) {
      return;
    }

    // TODO: don't iterate through all history events on each operation update
    this.events.length = 0;
    this.events.push(...this.indexedOperations.getHistoryEvents());

    // Notify via callback
    this.onCheckpointReceived(
      newCheckpointOperations,
      this.getTrackedOperations(),
    );
  }
}
