import { IndexedOperations } from "../../common/indexed-operations";
import { OperationEvents } from "../../common/operations/operation-with-data";
import { DurableOperation } from "../../types/durable-operation";
import { OperationWaitManager } from "./operation-wait-manager";
import { OperationStorage } from "../../common/operation-storage";
import { Event } from "@aws-sdk/client-lambda";
import { DurableApiClient } from "../../common/create-durable-api-client";

export class LocalOperationStorage extends OperationStorage {
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

  addHistoryEvent(event: Event) {
    this.indexedOperations.addHistoryEvent(event);
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
