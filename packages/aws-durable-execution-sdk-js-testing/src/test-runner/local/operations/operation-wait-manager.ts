import {
  Operation,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { WaitingOperationStatus } from "../../types/durable-operation";
import { DurableOperation } from "../../types/durable-operation";
import { doesStatusMatch } from "./status-matcher";
import { OperationEvents } from "../../common/operations/operation-with-data";
import { IndexedOperations } from "../../common/indexed-operations";
import { OperationSubType } from "@aws/durable-execution-sdk-js";

interface WaitingOperation {
  operation: DurableOperation<unknown>;
  resolve: () => void;
  reject: () => void;
  expectedStatus: WaitingOperationStatus;
}

/**
 * Manages waiting operations and promise resolution for mock operations.
 * @internal
 */
export class OperationWaitManager {
  private readonly waitingOperations = new Set<WaitingOperation>();

  constructor(private readonly indexedOperations: IndexedOperations) {}

  /**
   * Creates a promise that resolves when the specified operation reaches the expected status.
   * @param operation - The mock operation to wait for
   * @param status - The expected status (defaults to STARTED)
   * @returns Promise that resolves with the mock operation when the status is reached
   */
  waitForOperation(
    operation: DurableOperation<unknown>,
    status: WaitingOperationStatus,
  ): Promise<DurableOperation<unknown>> {
    // Create rejected error outside promise for better call stack
    const error = new Error(
      `Operation was not found after execution completion. Expected status: ${status}. This typically means the operation was never executed or the test is waiting for the wrong operation.`,
    );
    return new Promise<DurableOperation<unknown>>((resolve, reject) => {
      this.waitingOperations.add({
        operation,
        resolve: () => {
          resolve(operation);
        },
        reject: () => {
          reject(error);
        },
        expectedStatus: status,
      });
    });
  }

  private isSubmitterOfWaitForCallback(operation: Operation): boolean {
    if (
      operation.Type === OperationType.STEP &&
      operation.ParentId !== undefined
    ) {
      const parentOperation = this.indexedOperations.getById(
        operation.ParentId,
      );
      return (
        parentOperation?.operation.Type === OperationType.CONTEXT &&
        parentOperation.operation.SubType === OperationSubType.WAIT_FOR_CALLBACK
      );
    }
    return false;
  }

  private isCallbackOperation(operation: Operation): boolean {
    return (
      operation.Type === OperationType.CALLBACK &&
      operation.ParentId !== undefined
    );
  }

  /**
   * Handles checkpoint operations and resolves waiting operations.
   * @param checkpointOperationsReceived - All checkpoint operations received
   * @param trackedDurableOperations - Operations that just got populated with data
   */
  handleCheckpointReceived(
    checkpointOperationsReceived: OperationEvents[],
    trackedDurableOperations: DurableOperation<unknown>[],
  ): void {
    for (const { operation } of checkpointOperationsReceived) {
      const parentId = operation.ParentId;
      if (!parentId) {
        continue;
      }

      // Handle submitter operations (STEP) - these resolve STARTED and SUBMITTED, but NOT COMPLETED
      if (this.isSubmitterOfWaitForCallback(operation)) {
        this.resolveOperationsByParentId(parentId, operation.Status, [
          WaitingOperationStatus.STARTED,
          WaitingOperationStatus.SUBMITTED,
        ]);
        // Handle callback operations - these resolve all statuses (STARTED, SUBMITTED, and COMPLETED)
      } else if (this.isCallbackOperation(operation)) {
        this.resolveOperationsByParentId(parentId, operation.Status);
      }
    }

    // Handle operations that are tracked
    trackedDurableOperations.forEach((op) => {
      const status = op.getStatus();
      this.resolveMatchingOperations(op, status);
    });
  }

  private shouldBeResolvedByParent(
    operation: DurableOperation<unknown>,
  ): boolean {
    return operation.isWaitForCallback();
  }

  /**
   * Resolves waiting operations that match the given operation and status.
   */
  private resolveMatchingOperations(
    operation: DurableOperation<unknown>,
    status?: OperationStatus,
  ): void {
    const toResolve = Array.from(this.waitingOperations).filter(
      (waiting) =>
        waiting.operation === operation &&
        !this.shouldBeResolvedByParent(waiting.operation) &&
        doesStatusMatch(status, waiting.expectedStatus),
    );

    toResolve.forEach((waiting) => {
      waiting.resolve();
      this.waitingOperations.delete(waiting);
    });
  }

  /**
   * Resolves parent operations by matching parent ID and allowed statuses.
   */
  private resolveOperationsByParentId(
    parentId: string,
    status: OperationStatus | undefined,
    allowedStatuses?: WaitingOperationStatus[],
  ): void {
    const toResolve = Array.from(this.waitingOperations).filter(
      (waiting) =>
        waiting.operation.getId() === parentId &&
        this.shouldBeResolvedByParent(waiting.operation) &&
        (allowedStatuses === undefined ||
          allowedStatuses.includes(waiting.expectedStatus)) &&
        doesStatusMatch(status, waiting.expectedStatus),
    );

    toResolve.forEach((waiting) => {
      waiting.resolve();
      this.waitingOperations.delete(waiting);
    });
  }

  /**
   * Clears all waiting operations and rejects any pending promises.
   * This should be called when execution completes to ensure operations
   * that were never found don't hang indefinitely.
   */
  clearWaitingOperations(): void {
    if (this.waitingOperations.size > 0) {
      Array.from(this.waitingOperations).forEach((waiting) => {
        waiting.reject();
      });
    }
    this.waitingOperations.clear();
  }

  /**
   * Gets the number of operations currently being waited for.
   * Useful for testing and debugging.
   * @returns The total number of waiting operations
   */
  getWaitingOperationsCount(): number {
    return this.waitingOperations.size;
  }
}
