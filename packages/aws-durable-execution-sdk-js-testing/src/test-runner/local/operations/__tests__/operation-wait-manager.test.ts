import { OperationWaitManager } from "../operation-wait-manager";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { WaitingOperationStatus } from "../../../durable-test-runner";
import { IndexedOperations } from "../../../common/indexed-operations";
import {
  OperationEvents,
  OperationWithData,
} from "../../../common/operations/operation-with-data";
import { OperationSubType } from "aws-durable-execution-sdk-js";

describe("OperationWaitManager", () => {
  let waitManager: OperationWaitManager;
  let testOperation: OperationWithData;
  let operationIndex: IndexedOperations;

  beforeEach(() => {
    waitManager = new OperationWaitManager();
    operationIndex = new IndexedOperations([]);
    testOperation = new OperationWithData(waitManager, operationIndex, {
      operation: {
        Id: "test-op-id",
        Name: "test-operation",
        Type: OperationType.STEP,
        Status: OperationStatus.PENDING,
      },
      events: [],
    });
  });

  // Helper function to trigger operation resolution
  const triggerOperationResolution = (
    operation: OperationWithData,
    status: OperationStatus
  ) => {
    // Update the operation's internal data to have the new status
    const originalData = operation.getOperationData()!;
    const updatedCheckpointOperation = {
      operation: {
        ...originalData,
        Status: status,
      },
      events: [],
    };

    // Use populateData to update the same operation object
    operation.populateData(updatedCheckpointOperation);

    // Trigger resolution with the same operation object
    waitManager.handleCheckpointReceived([], [operation]);
  };

  describe("waitForOperation", () => {
    it("should create a promise that resolves when the expected status is reached", async () => {
      // Act
      const waitPromise = waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.COMPLETED
      );

      // Trigger resolution
      triggerOperationResolution(testOperation, OperationStatus.SUCCEEDED);

      // Assert
      const result = await waitPromise;
      expect(result).toBe(testOperation);
    });

    it("should default to STARTED status when no status is provided", async () => {
      // Act
      const waitPromise = waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.STARTED
      );

      // Trigger resolution
      triggerOperationResolution(testOperation, OperationStatus.STARTED);

      // Assert
      const result = await waitPromise;
      expect(result).toBe(testOperation);
    });

    it("should support multiple waiters for the same operation", async () => {
      // Act
      const waitPromise1 = waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.COMPLETED
      );
      const waitPromise2 = waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.COMPLETED
      );

      // Trigger resolution
      triggerOperationResolution(testOperation, OperationStatus.SUCCEEDED);

      // Assert
      const [result1, result2] = await Promise.all([
        waitPromise1,
        waitPromise2,
      ]);
      expect(result1).toBe(testOperation);
      expect(result2).toBe(testOperation);
    });

    it("should support multiple waiters with different expected statuses", async () => {
      // Act
      const waitForStarted = waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.STARTED
      );
      const waitForCompleted = waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.COMPLETED
      );

      // Trigger STARTED resolution
      triggerOperationResolution(testOperation, OperationStatus.STARTED);

      // Assert first waiter resolves
      const startedResult = await waitForStarted;
      expect(startedResult).toBe(testOperation);

      // Trigger SUCCEEDED resolution
      triggerOperationResolution(testOperation, OperationStatus.SUCCEEDED);

      // Assert second waiter resolves
      const completedResult = await waitForCompleted;
      expect(completedResult).toBe(testOperation);
    });
  });

  describe("tryResolveWaitingOperations", () => {
    describe("Status Mapping", () => {
      describe("Positive cases", () => {
        // Positive cases - operations that should resolve specific wait statuses
        it.each([
          [OperationStatus.STARTED, WaitingOperationStatus.STARTED],
          [OperationStatus.READY, WaitingOperationStatus.STARTED],
          [OperationStatus.PENDING, WaitingOperationStatus.STARTED],
          [OperationStatus.SUCCEEDED, WaitingOperationStatus.COMPLETED],
          [OperationStatus.FAILED, WaitingOperationStatus.COMPLETED],
          [OperationStatus.CANCELLED, WaitingOperationStatus.COMPLETED],
          [OperationStatus.STOPPED, WaitingOperationStatus.COMPLETED],
          [OperationStatus.TIMED_OUT, WaitingOperationStatus.COMPLETED],
        ])(
          "should resolve: %s resolves %s",
          async (operationStatus, waitStatus) => {
            // Create a promise waiting for the specified waiting status
            const waitPromise = waitManager.waitForOperation(
              testOperation,
              waitStatus
            );

            // Try to resolve the promise with the operation status
            triggerOperationResolution(testOperation, operationStatus);

            // The promise should have resolved
            const result = await waitPromise;
            expect(result).toBe(testOperation);
          }
        );
      });

      describe("Negative cases", () => {
        // Negative cases - operations that should NOT resolve specific wait statuses
        it.each([
          [OperationStatus.STARTED, WaitingOperationStatus.COMPLETED],
          [OperationStatus.SUCCEEDED, WaitingOperationStatus.STARTED],
          [OperationStatus.FAILED, WaitingOperationStatus.STARTED],
        ])(
          "should not resolve: %s doesn't resolve %s",
          async (operationStatus, waitStatus) => {
            // Create a promise waiting for the specified waiting status
            const waitPromise = waitManager.waitForOperation(
              testOperation,
              waitStatus
            );

            // Try to resolve the promise with the operation status
            triggerOperationResolution(testOperation, operationStatus);

            // Check the promise is still pending
            const stillPending = await Promise.race([
              waitPromise.then(() => false),
              Promise.resolve(true),
            ]);

            // The promise should still be pending (not resolved)
            expect(stillPending).toBe(true);
          }
        );
      });

      it("should not resolve any wait status when operation has no status", async () => {
        // Create operation with undefined status
        const operationWithoutStatus = new OperationWithData(
          waitManager,
          operationIndex,
          {
            operation: {
              Id: "no-status-op",
              Type: OperationType.STEP,
              // Status is undefined
            },
            events: [],
          }
        );

        // Create promises for both wait statuses
        const startedPromise = waitManager.waitForOperation(
          operationWithoutStatus,
          WaitingOperationStatus.STARTED
        );
        const completedPromise = waitManager.waitForOperation(
          operationWithoutStatus,
          WaitingOperationStatus.COMPLETED
        );

        // Try to resolve the promises with the operation that has no status
        waitManager.handleCheckpointReceived([], [operationWithoutStatus]);

        // Check if the promises are still pending
        const startedStillPending = await Promise.race([
          startedPromise.then(() => false),
          Promise.resolve(true),
        ]);

        const completedStillPending = await Promise.race([
          completedPromise.then(() => false),
          Promise.resolve(true),
        ]);

        // Both promises should still be pending
        expect(startedStillPending).toBe(true);
        expect(completedStillPending).toBe(true);
      });
    });

    it("should handle operations with no waiting operations gracefully", () => {
      // Act & Assert - Should not throw
      expect(() => {
        waitManager.handleCheckpointReceived([], [testOperation]);
      }).not.toThrow();
    });

    it("should clean up empty waiting sets after resolution", async () => {
      // Act
      const waitPromise = waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.COMPLETED
      );
      expect(waitManager.getWaitingOperationsCount()).toBe(1);

      triggerOperationResolution(testOperation, OperationStatus.SUCCEEDED);
      await waitPromise;

      // Assert - Count should be 0 after resolution and cleanup
      expect(waitManager.getWaitingOperationsCount()).toBe(0);
    });
  });

  describe("clearWaitingOperations", () => {
    it("should clear all waiting operations when no specific operation is provided", () => {
      // Arrange
      const testOperation2 = new OperationWithData(
        waitManager,
        operationIndex,
        {
          operation: {
            Id: "test-op-2-id",
            Name: "test-operation-2",
            Type: OperationType.STEP,
            Status: OperationStatus.PENDING,
          },
          events: [],
        }
      );
      void waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.STARTED
      );
      void waitManager.waitForOperation(
        testOperation2,
        WaitingOperationStatus.COMPLETED
      );
      expect(waitManager.getWaitingOperationsCount()).toBe(2);

      // Act
      waitManager.clearWaitingOperations();

      // Assert
      expect(waitManager.getWaitingOperationsCount()).toBe(0);
    });
  });

  describe("getWaitingOperationsCount", () => {
    it("should return 0 when no operations are waiting", () => {
      expect(waitManager.getWaitingOperationsCount()).toBe(0);
    });

    it("should return the correct count of waiting operations", () => {
      // Arrange
      const testOperation2 = new OperationWithData(
        waitManager,
        operationIndex,
        {
          operation: {
            Id: "test-op-2-id",
            Name: "test-operation-2",
            Type: OperationType.STEP,
            Status: OperationStatus.PENDING,
          },
          events: [],
        }
      );

      // Act
      void waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.STARTED
      );
      void waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.COMPLETED
      );
      void waitManager.waitForOperation(
        testOperation2,
        WaitingOperationStatus.STARTED
      );

      // Assert
      expect(waitManager.getWaitingOperationsCount()).toBe(3);
    });
  });

  describe("Parent Resolution Logic", () => {
    // Helper function to create a waitForCallback operation
    const createWaitForCallbackOperation = (
      id: string,
      status: OperationStatus = OperationStatus.PENDING
    ) =>
      new OperationWithData(waitManager, operationIndex, {
        operation: {
          Id: id,
          Type: OperationType.CONTEXT,
          SubType: OperationSubType.WAIT_FOR_CALLBACK,
          Status: status,
        },
        events: [],
      });

    // Helper function to create a regular (non-waitForCallback) operation
    const createRegularOperation = (
      id: string,
      status: OperationStatus = OperationStatus.PENDING
    ) =>
      new OperationWithData(waitManager, operationIndex, {
        operation: {
          Id: id,
          Type: OperationType.STEP,
          Status: status,
        },
        events: [],
      });

    // Helper function to create a callback checkpoint operation
    const createCallbackCheckpointOperation = (
      parentId: string,
      status: OperationStatus = OperationStatus.SUCCEEDED
    ): OperationEvents => ({
      operation: {
        Id: "callback-op-id",
        Type: OperationType.CALLBACK,
        ParentId: parentId,
        Status: status,
      },
      events: [],
    });

    // Helper function to create a non-callback checkpoint operation
    const createNonCallbackCheckpointOperation = (
      type: OperationType = OperationType.STEP,
      parentId?: string
    ): OperationEvents => ({
      operation: {
        Id: "non-callback-op-id",
        Type: type,
        ParentId: parentId,
        Status: OperationStatus.SUCCEEDED,
      },
      events: [],
    });

    describe("handleCheckpointReceived with callback operations", () => {
      it("should resolve parent operations when callback operation is received", async () => {
        // Arrange - Create a parent operation (waitForCallback)
        const parentOperation = createWaitForCallbackOperation("parent-op-id");

        // Create a promise waiting for the parent operation
        const waitPromise = waitManager.waitForOperation(
          parentOperation,
          WaitingOperationStatus.COMPLETED
        );

        // Act - Trigger callback operation with matching parent ID
        const callbackOperation = createCallbackCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED
        );
        waitManager.handleCheckpointReceived([callbackOperation], []);

        // Assert - Parent operation should be resolved
        const result = await waitPromise;
        expect(result).toBe(parentOperation);
        expect(waitManager.getWaitingOperationsCount()).toBe(0);
      });

      it("should resolve multiple parent operations with same parent ID", async () => {
        // Arrange - Create multiple operations waiting for same parent
        const parentOperation1 = createWaitForCallbackOperation("parent-op-id");
        const parentOperation2 = createWaitForCallbackOperation("parent-op-id");

        const waitPromise1 = waitManager.waitForOperation(
          parentOperation1,
          WaitingOperationStatus.COMPLETED
        );
        const waitPromise2 = waitManager.waitForOperation(
          parentOperation2,
          WaitingOperationStatus.COMPLETED
        );

        // Act - Trigger callback operation
        const callbackOperation = createCallbackCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED
        );
        waitManager.handleCheckpointReceived([callbackOperation], []);

        // Assert - Both operations should be resolved
        const [result1, result2] = await Promise.all([
          waitPromise1,
          waitPromise2,
        ]);
        expect(result1).toBe(parentOperation1);
        expect(result2).toBe(parentOperation2);
        expect(waitManager.getWaitingOperationsCount()).toBe(0);
      });

      it("should not resolve operations with different parent IDs", async () => {
        // Arrange - Create operation with different parent ID
        const parentOperation = createWaitForCallbackOperation(
          "different-parent-id"
        );

        const waitPromise = waitManager.waitForOperation(
          parentOperation,
          WaitingOperationStatus.COMPLETED
        );

        // Act - Trigger callback operation with different parent ID
        const callbackOperation = createCallbackCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED
        );
        waitManager.handleCheckpointReceived([callbackOperation], []);

        // Assert - Operation should not be resolved
        const stillPending = await Promise.race([
          waitPromise.then(() => false),
          Promise.resolve(true),
        ]);

        expect(stillPending).toBe(true);
        expect(waitManager.getWaitingOperationsCount()).toBe(1);
      });

      it("should respect status matching for parent resolution", async () => {
        // Arrange - Create parent operation waiting for STARTED status
        const parentOperation = createWaitForCallbackOperation("parent-op-id");

        const waitPromise = waitManager.waitForOperation(
          parentOperation,
          WaitingOperationStatus.STARTED
        );

        // Act - Trigger callback operation with SUCCEEDED status (should resolve STARTED)
        const callbackOperation = createCallbackCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED
        );
        waitManager.handleCheckpointReceived([callbackOperation], []);

        // Assert - Operation should be resolved (SUCCEEDED matches STARTED via status-matcher)
        const result = await waitPromise;
        expect(result).toBe(parentOperation);
      });

      it("should not resolve parent operations for non-callback operations", async () => {
        // Arrange - Create parent operation
        const parentOperation = createWaitForCallbackOperation("parent-op-id");

        const waitPromise = waitManager.waitForOperation(
          parentOperation,
          WaitingOperationStatus.COMPLETED
        );

        // Act - Trigger non-callback operation (should not trigger parent resolution)
        const nonCallbackOperation = createNonCallbackCheckpointOperation(
          OperationType.STEP,
          "parent-op-id"
        );
        waitManager.handleCheckpointReceived([nonCallbackOperation], []);

        // Assert - Operation should not be resolved
        const stillPending = await Promise.race([
          waitPromise.then(() => false),
          Promise.resolve(true),
        ]);

        expect(stillPending).toBe(true);
        expect(waitManager.getWaitingOperationsCount()).toBe(1);
      });

      it("should not resolve parent operations for callback operations without ParentId", async () => {
        // Arrange - Create parent operation
        const parentOperation = createWaitForCallbackOperation("parent-op-id");

        const waitPromise = waitManager.waitForOperation(
          parentOperation,
          WaitingOperationStatus.COMPLETED
        );

        // Act - Trigger callback operation without ParentId
        const callbackWithoutParent: OperationEvents = {
          operation: {
            Id: "callback-op-id",
            Type: OperationType.CALLBACK,
            Status: OperationStatus.SUCCEEDED,
            // ParentId is undefined
          },
          events: [],
        };
        waitManager.handleCheckpointReceived([callbackWithoutParent], []);

        // Assert - Operation should not be resolved
        const stillPending = await Promise.race([
          waitPromise.then(() => false),
          Promise.resolve(true),
        ]);

        expect(stillPending).toBe(true);
        expect(waitManager.getWaitingOperationsCount()).toBe(1);
      });

      it("should not resolve non-waitForCallback operations via parent resolution", async () => {
        // Arrange - Create regular operation (not waitForCallback)
        const regularOperation = createRegularOperation("parent-op-id");

        const waitPromise = waitManager.waitForOperation(
          regularOperation,
          WaitingOperationStatus.COMPLETED
        );

        // Act - Trigger callback operation (should not resolve non-waitForCallback operations)
        const callbackOperation = createCallbackCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED
        );
        waitManager.handleCheckpointReceived([callbackOperation], []);

        // Assert - Operation should not be resolved via parent resolution
        const stillPending = await Promise.race([
          waitPromise.then(() => false),
          Promise.resolve(true),
        ]);

        expect(stillPending).toBe(true);
        expect(waitManager.getWaitingOperationsCount()).toBe(1);
      });
    });

    describe("Mixed resolution scenarios", () => {
      it("should handle both callback and direct operation resolution in same call", async () => {
        // Arrange - Create both parent and direct operations
        const parentOperation = createWaitForCallbackOperation("parent-op-id");
        const directOperation = new OperationWithData(
          waitManager,
          operationIndex,
          {
            operation: {
              Id: "direct-op-id",
              Type: OperationType.STEP,
              Status: OperationStatus.SUCCEEDED,
            },
            events: [],
          }
        );

        const parentWaitPromise = waitManager.waitForOperation(
          parentOperation,
          WaitingOperationStatus.COMPLETED
        );
        const directWaitPromise = waitManager.waitForOperation(
          directOperation,
          WaitingOperationStatus.COMPLETED
        );

        // Act - Trigger both callback and direct operations
        const callbackOperation = createCallbackCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED
        );
        waitManager.handleCheckpointReceived(
          [callbackOperation],
          [directOperation]
        );

        // Assert - Both operations should be resolved
        const [parentResult, directResult] = await Promise.all([
          parentWaitPromise,
          directWaitPromise,
        ]);

        expect(parentResult).toBe(parentOperation);
        expect(directResult).toBe(directOperation);
        expect(waitManager.getWaitingOperationsCount()).toBe(0);
      });

      it("should process multiple callback operations correctly", async () => {
        // Arrange - Create multiple parent operations
        const parent1 = createWaitForCallbackOperation("parent-1");
        const parent2 = createWaitForCallbackOperation("parent-2");

        const wait1 = waitManager.waitForOperation(
          parent1,
          WaitingOperationStatus.COMPLETED
        );
        const wait2 = waitManager.waitForOperation(
          parent2,
          WaitingOperationStatus.COMPLETED
        );

        // Act - Trigger multiple callback operations
        const callback1 = createCallbackCheckpointOperation(
          "parent-1",
          OperationStatus.SUCCEEDED
        );
        const callback2 = createCallbackCheckpointOperation(
          "parent-2",
          OperationStatus.FAILED
        );
        waitManager.handleCheckpointReceived([callback1, callback2], []);

        // Assert - Both parents should be resolved
        const [result1, result2] = await Promise.all([wait1, wait2]);
        expect(result1).toBe(parent1);
        expect(result2).toBe(parent2);
        expect(waitManager.getWaitingOperationsCount()).toBe(0);
      });
    });
  });
});
