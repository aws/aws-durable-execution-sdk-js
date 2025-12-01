import { OperationWaitManager } from "../operation-wait-manager";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { WaitingOperationStatus } from "../../../types/durable-operation";
import { IndexedOperations } from "../../../common/indexed-operations";
import {
  OperationEvents,
  OperationWithData,
} from "../../../common/operations/operation-with-data";
import { OperationSubType } from "@aws/durable-execution-sdk-js";
import { DurableApiClient } from "../../../common/create-durable-api-client";

describe("OperationWaitManager", () => {
  let waitManager: OperationWaitManager;
  let testOperation: OperationWithData;
  let operationIndex: IndexedOperations;

  beforeEach(() => {
    operationIndex = new IndexedOperations([]);
    waitManager = new OperationWaitManager(operationIndex);
    testOperation = new OperationWithData(
      waitManager,
      operationIndex,
      {} as DurableApiClient,
      {
        operation: {
          Id: "test-op-id",
          Name: "test-operation",
          Type: OperationType.STEP,
          Status: OperationStatus.PENDING,
          StartTimestamp: undefined,
        },
        events: [],
      },
    );
  });

  // Helper function to trigger operation resolution
  const triggerOperationResolution = (
    operation: OperationWithData,
    status: OperationStatus,
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
        WaitingOperationStatus.COMPLETED,
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
        WaitingOperationStatus.STARTED,
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
        WaitingOperationStatus.COMPLETED,
      );
      const waitPromise2 = waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.COMPLETED,
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
        WaitingOperationStatus.STARTED,
      );
      const waitForCompleted = waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.COMPLETED,
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
          [OperationStatus.SUCCEEDED, WaitingOperationStatus.STARTED],
          [OperationStatus.FAILED, WaitingOperationStatus.STARTED],
          [OperationStatus.SUCCEEDED, WaitingOperationStatus.COMPLETED],
          [OperationStatus.FAILED, WaitingOperationStatus.COMPLETED],
          [OperationStatus.CANCELLED, WaitingOperationStatus.COMPLETED],
          [OperationStatus.STOPPED, WaitingOperationStatus.COMPLETED],
          [OperationStatus.TIMED_OUT, WaitingOperationStatus.COMPLETED],
          [OperationStatus.SUCCEEDED, WaitingOperationStatus.SUBMITTED],
          [OperationStatus.FAILED, WaitingOperationStatus.SUBMITTED],
          [OperationStatus.CANCELLED, WaitingOperationStatus.SUBMITTED],
          [OperationStatus.STOPPED, WaitingOperationStatus.SUBMITTED],
          [OperationStatus.TIMED_OUT, WaitingOperationStatus.SUBMITTED],
        ])(
          "should resolve: %s resolves %s",
          async (operationStatus, waitStatus) => {
            // Create a promise waiting for the specified waiting status
            const waitPromise = waitManager.waitForOperation(
              testOperation,
              waitStatus,
            );

            // Try to resolve the promise with the operation status
            triggerOperationResolution(testOperation, operationStatus);

            // The promise should have resolved
            const result = await waitPromise;
            expect(result).toBe(testOperation);
          },
        );
      });

      describe("Negative cases", () => {
        // Negative cases - operations that should NOT resolve specific wait statuses
        it.each([
          [OperationStatus.STARTED, WaitingOperationStatus.COMPLETED],
          [OperationStatus.STARTED, WaitingOperationStatus.SUBMITTED],
          [OperationStatus.READY, WaitingOperationStatus.SUBMITTED],
          [OperationStatus.PENDING, WaitingOperationStatus.SUBMITTED],
        ])(
          "should not resolve: %s doesn't resolve %s",
          async (operationStatus, waitStatus) => {
            // Create a promise waiting for the specified waiting status
            const waitPromise = waitManager.waitForOperation(
              testOperation,
              waitStatus,
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

            // Clean up the pending promise to avoid unhandled rejection
            waitManager.clearWaitingOperations();
            await expect(waitPromise).rejects.toThrow();
          },
        );
      });

      it("should not resolve any wait status when operation has no status", async () => {
        // Create operation with undefined status
        const operationWithoutStatus = new OperationWithData(
          waitManager,
          operationIndex,
          {} as DurableApiClient,
          {
            operation: {
              Id: "no-status-op",
              Type: OperationType.STEP,
              StartTimestamp: undefined,
              Status: undefined,
            },
            events: [],
          },
        );

        // Create promises for all wait statuses
        const startedPromise = waitManager.waitForOperation(
          operationWithoutStatus,
          WaitingOperationStatus.STARTED,
        );
        const completedPromise = waitManager.waitForOperation(
          operationWithoutStatus,
          WaitingOperationStatus.COMPLETED,
        );
        const submittedPromise = waitManager.waitForOperation(
          operationWithoutStatus,
          WaitingOperationStatus.SUBMITTED,
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

        const submittedStillPending = await Promise.race([
          submittedPromise.then(() => false),
          Promise.resolve(true),
        ]);

        // All promises should still be pending
        expect(startedStillPending).toBe(true);
        expect(completedStillPending).toBe(true);
        expect(submittedStillPending).toBe(true);

        // Clean up pending promises to avoid unhandled rejections
        waitManager.clearWaitingOperations();
        await expect(startedPromise).rejects.toThrow();
        await expect(completedPromise).rejects.toThrow();
        await expect(submittedPromise).rejects.toThrow();
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
        WaitingOperationStatus.COMPLETED,
      );
      expect(waitManager.getWaitingOperationsCount()).toBe(1);

      triggerOperationResolution(testOperation, OperationStatus.SUCCEEDED);
      await waitPromise;

      // Assert - Count should be 0 after resolution and cleanup
      expect(waitManager.getWaitingOperationsCount()).toBe(0);
    });
  });

  describe("clearWaitingOperations", () => {
    it("should clear all waiting operations and reject promises with descriptive error messages", async () => {
      // Arrange - Create operations with and without names
      const testOperation2 = new OperationWithData(
        waitManager,
        operationIndex,
        {} as DurableApiClient,
        {
          operation: {
            Id: "test-op-2-id",
            Name: "test-operation-2",
            Type: OperationType.STEP,
            Status: OperationStatus.PENDING,
            StartTimestamp: undefined,
          },
          events: [],
        },
      );
      const operationWithoutName = new OperationWithData(
        waitManager,
        operationIndex,
        {} as DurableApiClient,
        {
          operation: {
            Id: "no-name-op-id",
            Type: OperationType.STEP,
            Status: OperationStatus.PENDING,
            StartTimestamp: undefined,
          },
          events: [],
        },
      );

      const promise1 = waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.STARTED,
      );
      const promise2 = waitManager.waitForOperation(
        testOperation2,
        WaitingOperationStatus.COMPLETED,
      );
      const promise3 = waitManager.waitForOperation(
        operationWithoutName,
        WaitingOperationStatus.SUBMITTED,
      );
      expect(waitManager.getWaitingOperationsCount()).toBe(3);

      // Act
      waitManager.clearWaitingOperations();

      // Assert - All operations cleared and proper error messages
      expect(waitManager.getWaitingOperationsCount()).toBe(0);

      await Promise.all([
        expect(promise1).rejects.toThrow(
          "Operation was not found after execution completion. Expected status: STARTED. This typically means the operation was never executed or the test is waiting for the wrong operation.",
        ),
        expect(promise2).rejects.toThrow(
          "Operation was not found after execution completion. Expected status: COMPLETED. This typically means the operation was never executed or the test is waiting for the wrong operation.",
        ),
        expect(promise3).rejects.toThrow(
          "Operation was not found after execution completion. Expected status: SUBMITTED. This typically means the operation was never executed or the test is waiting for the wrong operation.",
        ),
      ]);
    });

    it("should not throw when clearing with no waiting operations", () => {
      expect(waitManager.getWaitingOperationsCount()).toBe(0);
      expect(() => {
        waitManager.clearWaitingOperations();
      }).not.toThrow();
    });
  });

  describe("getWaitingOperationsCount", () => {
    it("should track the count of waiting operations correctly", async () => {
      // Arrange
      const testOperation2 = new OperationWithData(
        waitManager,
        operationIndex,
        {} as DurableApiClient,
        {
          operation: {
            Id: "test-op-2-id",
            Name: "test-operation-2",
            Type: OperationType.STEP,
            Status: OperationStatus.PENDING,
            StartTimestamp: undefined,
          },
          events: [],
        },
      );

      // Act - Create promises to track the count
      const promise1 = waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.STARTED,
      );
      const promise2 = waitManager.waitForOperation(
        testOperation,
        WaitingOperationStatus.COMPLETED,
      );
      const promise3 = waitManager.waitForOperation(
        testOperation2,
        WaitingOperationStatus.STARTED,
      );

      // Assert
      expect(waitManager.getWaitingOperationsCount()).toBe(3);

      // Clean up to avoid unhandled promise rejections
      waitManager.clearWaitingOperations();
      await expect(promise1).rejects.toThrow();
      await expect(promise2).rejects.toThrow();
      await expect(promise3).rejects.toThrow();
    });
  });

  describe("Parent Resolution Logic", () => {
    // Helper function to create a waitForCallback operation
    const createWaitForCallbackOperation = (
      id: string,
      status: OperationStatus = OperationStatus.PENDING,
    ) =>
      new OperationWithData(
        waitManager,
        operationIndex,
        {} as DurableApiClient,
        {
          operation: {
            Id: id,
            Type: OperationType.CONTEXT,
            SubType: OperationSubType.WAIT_FOR_CALLBACK,
            Status: status,
            StartTimestamp: undefined,
          },
          events: [],
        },
      );

    // Helper function to create a regular (non-waitForCallback) operation
    const createRegularOperation = (
      id: string,
      status: OperationStatus = OperationStatus.PENDING,
    ) =>
      new OperationWithData(
        waitManager,
        operationIndex,
        {} as DurableApiClient,
        {
          operation: {
            Id: id,
            Type: OperationType.STEP,
            Status: status,
            StartTimestamp: undefined,
          },
          events: [],
        },
      );

    // Helper function to create a callback checkpoint operation
    const createCallbackCheckpointOperation = (
      parentId: string,
      status: OperationStatus = OperationStatus.SUCCEEDED,
    ): OperationEvents => ({
      operation: {
        Id: "callback-op-id",
        Type: OperationType.CALLBACK,
        ParentId: parentId,
        Status: status,
        StartTimestamp: undefined,
      },
      events: [],
    });

    // Helper function to create a non-callback checkpoint operation
    const createNonCallbackCheckpointOperation = (
      type: OperationType = OperationType.STEP,
      parentId?: string,
    ): OperationEvents => ({
      operation: {
        Id: "non-callback-op-id",
        Type: type,
        ParentId: parentId,
        Status: OperationStatus.SUCCEEDED,
        StartTimestamp: undefined,
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
          WaitingOperationStatus.COMPLETED,
        );

        // Act - Trigger callback operation with matching parent ID
        const callbackOperation = createCallbackCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED,
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
          WaitingOperationStatus.COMPLETED,
        );
        const waitPromise2 = waitManager.waitForOperation(
          parentOperation2,
          WaitingOperationStatus.COMPLETED,
        );

        // Act - Trigger callback operation
        const callbackOperation = createCallbackCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED,
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
          "different-parent-id",
        );

        const waitPromise = waitManager.waitForOperation(
          parentOperation,
          WaitingOperationStatus.COMPLETED,
        );

        // Act - Trigger callback operation with different parent ID
        const callbackOperation = createCallbackCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED,
        );
        waitManager.handleCheckpointReceived([callbackOperation], []);

        // Assert - Operation should not be resolved
        const stillPending = await Promise.race([
          waitPromise.then(() => false),
          Promise.resolve(true),
        ]);

        expect(stillPending).toBe(true);
        expect(waitManager.getWaitingOperationsCount()).toBe(1);

        // Clean up pending promise to avoid unhandled rejection
        waitManager.clearWaitingOperations();
        await expect(waitPromise).rejects.toThrow();
      });

      it("should respect status matching for parent resolution", async () => {
        // Arrange - Create parent operation waiting for STARTED status
        const parentOperation = createWaitForCallbackOperation("parent-op-id");

        const waitPromise = waitManager.waitForOperation(
          parentOperation,
          WaitingOperationStatus.STARTED,
        );

        // Act - Trigger callback operation with SUCCEEDED status (should resolve STARTED)
        const callbackOperation = createCallbackCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED,
        );
        waitManager.handleCheckpointReceived([callbackOperation], []);

        // Assert - Operation should be resolved (SUCCEEDED matches STARTED via status-matcher)
        const result = await waitPromise;
        expect(result).toBe(parentOperation);
      });

      it("should resolve parent operations waiting for SUBMITTED status", async () => {
        // Arrange - Create parent operation waiting for SUBMITTED status
        const parentOperation = createWaitForCallbackOperation("parent-op-id");

        const waitPromise = waitManager.waitForOperation(
          parentOperation,
          WaitingOperationStatus.SUBMITTED,
        );

        // Act - Trigger callback operation with SUCCEEDED status (should resolve SUBMITTED)
        const callbackOperation = createCallbackCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED,
        );
        waitManager.handleCheckpointReceived([callbackOperation], []);

        // Assert - Operation should be resolved (SUCCEEDED matches SUBMITTED via status-matcher)
        const result = await waitPromise;
        expect(result).toBe(parentOperation);
      });

      it.each([
        {
          name: "non-callback operations",
          setup: () => ({
            parentOp: createWaitForCallbackOperation("parent-op-id"),
            checkpointOp: createNonCallbackCheckpointOperation(
              OperationType.STEP,
              "parent-op-id",
            ),
          }),
        },
        {
          name: "callback operations without ParentId",
          setup: () => ({
            parentOp: createWaitForCallbackOperation("parent-op-id"),
            checkpointOp: {
              operation: {
                Id: "callback-op-id",
                Type: OperationType.CALLBACK,
                Status: OperationStatus.SUCCEEDED,
                StartTimestamp: undefined,
              },
              events: [],
            } as OperationEvents,
          }),
        },
        {
          name: "non-waitForCallback parent operations",
          setup: () => ({
            parentOp: createRegularOperation("parent-op-id"),
            checkpointOp: createCallbackCheckpointOperation(
              "parent-op-id",
              OperationStatus.SUCCEEDED,
            ),
          }),
        },
      ])(
        "should not resolve parent operations for $name",
        async ({ setup }) => {
          const { parentOp, checkpointOp } = setup();

          const waitPromise = waitManager.waitForOperation(
            parentOp,
            WaitingOperationStatus.COMPLETED,
          );

          waitManager.handleCheckpointReceived([checkpointOp], []);

          const stillPending = await Promise.race([
            waitPromise.then(() => false),
            Promise.resolve(true),
          ]);

          expect(stillPending).toBe(true);
          expect(waitManager.getWaitingOperationsCount()).toBe(1);

          waitManager.clearWaitingOperations();
          await expect(waitPromise).rejects.toThrow();
        },
      );
    });

    describe("Submitter of WaitForCallback scenarios", () => {
      // Helper function to create a STEP checkpoint operation that submits to WaitForCallback
      const createStepCheckpointOperation = (
        parentId: string,
        status: OperationStatus = OperationStatus.SUCCEEDED,
      ): OperationEvents => ({
        operation: {
          Id: "step-submitter-id",
          Type: OperationType.STEP,
          ParentId: parentId,
          Status: status,
          StartTimestamp: undefined,
        },
        events: [],
      });

      it("should resolve parent WaitForCallback operation waiting for SUBMITTED when submitter STEP operation completes", async () => {
        // Arrange - Create parent WaitForCallback operation and add to index
        const parentOperation = createWaitForCallbackOperation("parent-op-id");
        const parentOperationData = parentOperation.getOperationData()!;
        operationIndex.addOperations([
          {
            operation: parentOperationData,
            events: [],
          },
        ]);

        // Create a promise waiting for the parent operation
        const waitPromise = waitManager.waitForOperation(
          parentOperation,
          WaitingOperationStatus.SUBMITTED,
        );

        // Act - Trigger STEP submitter operation with matching parent ID
        const stepSubmitterOperation = createStepCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED,
        );
        waitManager.handleCheckpointReceived([stepSubmitterOperation], []);

        // Assert - Parent WaitForCallback operation should be resolved
        const result = await waitPromise;
        expect(result).toBe(parentOperation);
        expect(waitManager.getWaitingOperationsCount()).toBe(0);
      });

      it("should NOT resolve parent WaitForCallback operation waiting for COMPLETED when submitter STEP operation completes", async () => {
        // Arrange - Create parent WaitForCallback operation and add to index
        const parentOperation = createWaitForCallbackOperation("parent-op-id");
        const parentOperationData = parentOperation.getOperationData()!;
        operationIndex.addOperations([
          {
            operation: parentOperationData,
            events: [],
          },
        ]);

        // Create a promise waiting for COMPLETED (should NOT resolve with STEP submitter)
        const waitPromise = waitManager.waitForOperation(
          parentOperation,
          WaitingOperationStatus.COMPLETED,
        );

        // Act - Trigger STEP submitter operation with matching parent ID
        const stepSubmitterOperation = createStepCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED,
        );
        waitManager.handleCheckpointReceived([stepSubmitterOperation], []);

        // Assert - Parent should NOT be resolved
        const stillPending = await Promise.race([
          waitPromise.then(() => false),
          Promise.resolve(true),
        ]);

        expect(stillPending).toBe(true);
        expect(waitManager.getWaitingOperationsCount()).toBe(1);

        // Clean up pending promise to avoid unhandled rejection
        waitManager.clearWaitingOperations();
        await expect(waitPromise).rejects.toThrow();
      });

      it.each([
        {
          name: "STEP operation has non-WaitForCallback parent",
          setup: () => {
            const regularParentOperation = new OperationWithData(
              waitManager,
              operationIndex,
              {} as DurableApiClient,
              {
                operation: {
                  Id: "regular-parent-id",
                  Type: OperationType.CONTEXT,
                  Status: OperationStatus.PENDING,
                  StartTimestamp: undefined,
                },
                events: [],
              },
            );
            operationIndex.addOperations([
              {
                operation: regularParentOperation.getOperationData()!,
                events: [],
              },
            ]);
            return {
              parentOp: regularParentOperation,
              stepOp: createStepCheckpointOperation(
                "regular-parent-id",
                OperationStatus.SUCCEEDED,
              ),
            };
          },
        },
        {
          name: "STEP operation has no ParentId",
          setup: () => ({
            parentOp: createWaitForCallbackOperation("parent-op-id"),
            stepOp: {
              operation: {
                Id: "step-no-parent-id",
                Type: OperationType.STEP,
                Status: OperationStatus.SUCCEEDED,
                StartTimestamp: undefined,
              },
              events: [],
            } as OperationEvents,
          }),
        },
        {
          name: "parent operation is not found in index",
          setup: () => ({
            parentOp: createWaitForCallbackOperation("parent-op-id"),
            stepOp: createStepCheckpointOperation(
              "parent-op-id",
              OperationStatus.SUCCEEDED,
            ),
          }),
        },
      ])("should not resolve parent when $name", async ({ setup }) => {
        const { parentOp, stepOp } = setup();

        const waitPromise = waitManager.waitForOperation(
          parentOp,
          WaitingOperationStatus.COMPLETED,
        );

        waitManager.handleCheckpointReceived([stepOp], []);

        const stillPending = await Promise.race([
          waitPromise.then(() => false),
          Promise.resolve(true),
        ]);

        expect(stillPending).toBe(true);
        expect(waitManager.getWaitingOperationsCount()).toBe(1);

        waitManager.clearWaitingOperations();
        await expect(waitPromise).rejects.toThrow();
      });

      it("should respect status matching for STEP submitter resolution", async () => {
        // Arrange - Create parent WaitForCallback operation and add to index
        const parentOperation = createWaitForCallbackOperation("parent-op-id");
        operationIndex.addOperations([
          {
            operation: parentOperation.getOperationData()!,
            events: [],
          },
        ]);

        const waitPromise = waitManager.waitForOperation(
          parentOperation,
          WaitingOperationStatus.STARTED,
        );

        // Act - Trigger STEP submitter with SUCCEEDED status (should resolve STARTED)
        const stepOperation = createStepCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED,
        );
        waitManager.handleCheckpointReceived([stepOperation], []);

        // Assert - Parent should be resolved (SUCCEEDED matches STARTED via status-matcher)
        const result = await waitPromise;
        expect(result).toBe(parentOperation);
      });

      it("should handle both STEP submitter and callback operations in same checkpoint", async () => {
        // Arrange - Create two different WaitForCallback parents and add to index
        const stepParent = createWaitForCallbackOperation("step-parent-id");
        const callbackParent =
          createWaitForCallbackOperation("callback-parent-id");
        operationIndex.addOperations([
          {
            operation: stepParent.getOperationData()!,
            events: [],
          },
          {
            operation: callbackParent.getOperationData()!,
            events: [],
          },
        ]);

        // STEP parent should wait for SUBMITTED (not COMPLETED)
        const stepParentWait = waitManager.waitForOperation(
          stepParent,
          WaitingOperationStatus.SUBMITTED,
        );
        // Callback parent can wait for COMPLETED
        const callbackParentWait = waitManager.waitForOperation(
          callbackParent,
          WaitingOperationStatus.COMPLETED,
        );

        // Act - Trigger both STEP submitter and callback operations
        const stepOperation = createStepCheckpointOperation(
          "step-parent-id",
          OperationStatus.SUCCEEDED,
        );
        const callbackOperation = createCallbackCheckpointOperation(
          "callback-parent-id",
          OperationStatus.SUCCEEDED,
        );
        waitManager.handleCheckpointReceived(
          [stepOperation, callbackOperation],
          [],
        );

        // Assert - Both parents should be resolved
        const [stepResult, callbackResult] = await Promise.all([
          stepParentWait,
          callbackParentWait,
        ]);

        expect(stepResult).toBe(stepParent);
        expect(callbackResult).toBe(callbackParent);
        expect(waitManager.getWaitingOperationsCount()).toBe(0);
      });
    });

    describe("Mixed resolution scenarios", () => {
      it("should handle both callback and direct operation resolution in same call", async () => {
        // Arrange - Create both parent and direct operations
        const parentOperation = createWaitForCallbackOperation("parent-op-id");
        const directOperation = new OperationWithData(
          waitManager,
          operationIndex,
          {} as DurableApiClient,
          {
            operation: {
              Id: "direct-op-id",
              Type: OperationType.STEP,
              Status: OperationStatus.SUCCEEDED,
              StartTimestamp: undefined,
            },
            events: [],
          },
        );

        const parentWaitPromise = waitManager.waitForOperation(
          parentOperation,
          WaitingOperationStatus.COMPLETED,
        );
        const directWaitPromise = waitManager.waitForOperation(
          directOperation,
          WaitingOperationStatus.COMPLETED,
        );

        // Act - Trigger both callback and direct operations
        const callbackOperation = createCallbackCheckpointOperation(
          "parent-op-id",
          OperationStatus.SUCCEEDED,
        );
        waitManager.handleCheckpointReceived(
          [callbackOperation],
          [directOperation],
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
          WaitingOperationStatus.COMPLETED,
        );
        const wait2 = waitManager.waitForOperation(
          parent2,
          WaitingOperationStatus.COMPLETED,
        );

        // Act - Trigger multiple callback operations
        const callback1 = createCallbackCheckpointOperation(
          "parent-1",
          OperationStatus.SUCCEEDED,
        );
        const callback2 = createCallbackCheckpointOperation(
          "parent-2",
          OperationStatus.FAILED,
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
