import {
  OperationAction,
  OperationStatus,
  OperationType,
  OperationUpdate,
} from "@aws-sdk/client-lambda";
import { CheckpointManager } from "../checkpoint-manager";
import {
  createExecutionId,
  createInvocationId,
} from "../../utils/tagged-strings";
import { CompleteCallbackStatus } from "../callback-manager";

// Mock crypto's randomUUID function
jest.mock("node:crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("mocked-uuid"),
}));

describe("CheckpointManager", () => {
  let storage: CheckpointManager;

  const mockInvocationId = createInvocationId();

  beforeEach(() => {
    storage = new CheckpointManager(createExecutionId("test-execution-id"));
    jest.clearAllMocks();
  });

  afterEach(() => {
    storage.cleanup();
  });

  describe("initialize", () => {
    it("should create initial operation with default payload", () => {
      const initialOperation = storage.initialize();

      expect(initialOperation).toMatchObject({
        Id: "mocked-uuid",
        Type: OperationType.EXECUTION,
        Status: OperationStatus.STARTED,
        ExecutionDetails: {
          InputPayload: "{}",
        },
      });

      expect(storage.operationDataMap.size).toBe(1);
      expect(storage.operationDataMap.get("mocked-uuid")).toBeDefined();
    });

    it("should create initial operation with custom payload", () => {
      const customPayload = '{"key":"value"}';
      const initialOperation = storage.initialize(customPayload);

      expect(initialOperation).toMatchObject({
        Id: "mocked-uuid",
        Type: OperationType.EXECUTION,
        Status: OperationStatus.STARTED,
        ExecutionDetails: {
          InputPayload: customPayload,
        },
      });

      expect(storage.operationDataMap.size).toBe(1);
    });
  });

  describe("getPendingCheckpointUpdates", () => {
    it("should return existing pending updates immediately", async () => {
      // Set up a pending update by registering an operation
      const update: OperationUpdate = {
        Id: "test-id",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        Payload: "my-payload",
      };
      storage.registerUpdate(update, mockInvocationId);

      const pendingUpdates = await storage.getPendingCheckpointUpdates();
      expect(pendingUpdates).toHaveLength(1);
      expect(pendingUpdates[0].update?.Id).toBe("test-id");
      // StepDetails.Result should not be populated in registerUpdate, only in completeOperation
      expect(pendingUpdates[0].operation.StepDetails?.Result).toBeUndefined();
      expect(pendingUpdates[0].operation.StepDetails?.Attempt).toBeUndefined();
    });

    it("should wait for updates if none exist yet", async () => {
      // Start the promise but don't await yet
      const pendingUpdatesPromise = storage.getPendingCheckpointUpdates();

      // Register an update after a small delay
      setTimeout(() => {
        const update: OperationUpdate = {
          Id: "delayed-id",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        };
        storage.registerUpdate(update, mockInvocationId);
      }, 10);

      // Now await the promise
      const pendingUpdates = await pendingUpdatesPromise;
      expect(pendingUpdates).toHaveLength(1);
      expect(pendingUpdates[0].update?.Id).toBe("delayed-id");
    });

    it("should clear pending updates after retrieving", async () => {
      const update: OperationUpdate = {
        Id: "test-id",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      };
      storage.registerUpdate(update, mockInvocationId);

      // Retrieve updates first time
      const firstRetrieval = await storage.getPendingCheckpointUpdates();
      expect(firstRetrieval).toHaveLength(1);

      // Second retrieval should be empty (and would wait, so we need to trigger another update)
      const secondPromise = storage.getPendingCheckpointUpdates();
      const update2: OperationUpdate = {
        Id: "test-id-2",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      };
      storage.registerUpdate(update2, mockInvocationId);

      const secondRetrieval = await secondPromise;
      expect(secondRetrieval).toHaveLength(1);
      expect(secondRetrieval[0].update?.Id).toBe("test-id-2");
    });
  });

  describe("hasOperation", () => {
    it("should return true when operation exists", () => {
      const initialOperation = storage.initialize();
      expect(storage.hasOperation(initialOperation.Id)).toBe(true);
    });

    it.each([
      ["non-existent-id"],
      [undefined],
      [null as unknown as string],
      [""],
    ])("should return false for %s", (id) => {
      expect(storage.hasOperation(id)).toBe(false);
    });

    it("should return true for operations registered via registerUpdate", () => {
      const update: OperationUpdate = {
        Id: "registered-op",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      };

      storage.registerUpdate(update, mockInvocationId);
      expect(storage.hasOperation("registered-op")).toBe(true);
    });

    it("should return true after operation is completed", () => {
      const initialOperation = storage.initialize();

      storage.completeOperation({
        Id: initialOperation.Id,
        Action: OperationAction.SUCCEED,
      });

      expect(storage.hasOperation(initialOperation.Id)).toBe(true);
    });
  });

  describe("completeOperation", () => {
    it("should update operation status and add sequence", () => {
      // Initialize with an operation
      const initialOperation = storage.initialize();

      // Complete the operation
      const { operation } = storage.completeOperation({
        Id: initialOperation.Id,
        Action: OperationAction.SUCCEED,
      });

      expect(operation).toBeDefined();
      expect(operation.Status).toBe(OperationStatus.SUCCEEDED);
      expect(operation.EndTimestamp).toBeInstanceOf(Date);
    });

    it("should update operation with new step details", () => {
      // Initialize storage
      storage.initialize();

      // Register a step operation
      storage.registerUpdate(
        {
          Id: "new-id",
          Action: OperationAction.START,
          Type: OperationType.STEP,
        },
        mockInvocationId
      );

      // Complete the operation
      const { operation } = storage.completeOperation({
        Id: "new-id",
        Action: OperationAction.SUCCEED,
        Payload: "new payload",
      });

      expect(operation).toBeDefined();
      expect(operation.Status).toBe(OperationStatus.SUCCEEDED);
      expect(operation.EndTimestamp).toBeInstanceOf(Date);
      expect(operation.StepDetails?.Result).toEqual("new payload");
    });

    it("should not modify original operation object", () => {
      // Initialize with an operation
      const initialOperation = storage.initialize();

      // Complete the operation
      const { operation } = storage.completeOperation({
        Id: initialOperation.Id,
        Action: OperationAction.SUCCEED,
      });

      // Check that the original operation object is not modified
      expect(initialOperation).not.toEqual(operation);
    });

    it("should throw error undefined for non-existent operation id", () => {
      expect(() =>
        storage.completeOperation({
          Id: "non-existent-id",
        })
      ).toThrow("Could not find operation");
    });

    it("should update operation with new context details", () => {
      // Initialize storage
      storage.initialize();

      // Register a step operation
      storage.registerUpdate(
        {
          Id: "new-id",
          Action: OperationAction.START,
          Type: OperationType.CONTEXT,
          ContextOptions: {
            ReplayChildren: true,
          },
        },
        mockInvocationId
      );

      // Complete the operation
      const { operation } = storage.completeOperation({
        Id: "new-id",
        Action: OperationAction.SUCCEED,
        Payload: "new payload",
      });

      expect(operation).toBeDefined();
      expect(operation.Status).toBe(OperationStatus.SUCCEEDED);
      expect(operation.EndTimestamp).toBeInstanceOf(Date);
      expect(operation.ContextDetails?.ReplayChildren).toBe(true);
      expect(operation.ContextDetails?.Result).toEqual("new payload");
    });
  });

  describe("registerUpdate", () => {
    it("should throw error if id is missing", () => {
      const updateWithoutId: OperationUpdate = {
        Type: OperationType.STEP,
        Action: OperationAction.START,
      };

      expect(() =>
        storage.registerUpdate(updateWithoutId, mockInvocationId)
      ).toThrow("Missing Id in update");
    });

    it("should create and register a new STEP operation", () => {
      const update: OperationUpdate = {
        Id: "step-id",
        Action: OperationAction.START,
        Name: "test-step",
        Type: OperationType.STEP,
      };

      const result = storage.registerUpdate(update, mockInvocationId);

      expect(result).toBeDefined();
      expect(result.operation.Id).toBe("step-id");
      expect(result.operation.Name).toBe("test-step");
      expect(result.operation.Type).toBe(OperationType.STEP);
      expect(result.operation.Status).toBe(OperationStatus.STARTED);
      expect(result.operation.StartTimestamp).toBeInstanceOf(Date);
      expect(result.operation.StepDetails).toBeUndefined();

      expect(storage.operationDataMap.get("step-id")).toBe(result);
    });

    it("should create and register a new CONTEXT operation", () => {
      const update: OperationUpdate = {
        Id: "CONTEXT-id",
        Name: "test-step",
        Action: OperationAction.START,
        Type: OperationType.CONTEXT,
        ContextOptions: {
          ReplayChildren: true,
        },
      };

      const result = storage.registerUpdate(update, mockInvocationId);

      expect(result).toBeDefined();
      expect(result.operation.Id).toBe("CONTEXT-id");
      expect(result.operation.Name).toBe("test-step");
      expect(result.operation.Type).toBe(OperationType.CONTEXT);
      expect(result.operation.Status).toBe(OperationStatus.STARTED);
      expect(result.operation.StartTimestamp).toBeInstanceOf(Date);
      expect(result.operation.StepDetails).toBeUndefined();
      expect(result.operation.ContextDetails?.ReplayChildren).toBe(true);

      expect(storage.operationDataMap.get("CONTEXT-id")).toBe(result);
    });

    it("should update operation with new step details", () => {
      // Initialize storage
      storage.initialize();

      // Register a step operation
      storage.registerUpdate(
        {
          Id: "new-id",
          Action: OperationAction.START,
          Type: OperationType.STEP,
        },
        mockInvocationId
      );

      // Register the operation
      const { operation } = storage.registerUpdate(
        {
          Id: "new-id",
          Action: OperationAction.SUCCEED,
          Payload: "new payload",
        },
        mockInvocationId
      );

      expect(operation).toBeDefined();
      expect(operation.Status).toBe(OperationStatus.SUCCEEDED);
      expect(operation.EndTimestamp).toBeInstanceOf(Date);
      expect(operation.StepDetails?.Result).toEqual("new payload");
    });

    it("should create STEP operation with payload but not store result in registerUpdate", () => {
      const update: OperationUpdate = {
        Id: "step-with-payload",
        Name: "process-data",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        Payload: JSON.stringify({ processed: true, value: 42 }),
      };

      const result = storage.registerUpdate(update, mockInvocationId);

      // Result should not be populated in registerUpdate, only in completeOperation
      expect(result.operation.StepDetails).toBeUndefined();
      expect(result.operation.Status).toBe(OperationStatus.STARTED);
    });

    it("should handle STEP operation with undefined payload", () => {
      const update: OperationUpdate = {
        Id: "step-no-payload",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        Payload: undefined,
      };

      const result = storage.registerUpdate(update, mockInvocationId);

      // Result should not be populated in registerUpdate, only in completeOperation
      expect(result.operation.StepDetails).toBeUndefined();
    });

    it("should create and register a new WAIT operation with scheduled timestamp", () => {
      const update: OperationUpdate = {
        Id: "wait-id",
        Name: "test-wait",
        Type: OperationType.WAIT,
        Action: OperationAction.START,
        WaitOptions: {
          WaitSeconds: 5,
        },
      };

      const result = storage.registerUpdate(update, mockInvocationId);

      expect(result).toBeDefined();
      expect(result.operation.Id).toBe("wait-id");
      expect(result.operation.Type).toBe(OperationType.WAIT);
      expect(result.operation.WaitDetails?.ScheduledTimestamp).toBeInstanceOf(
        Date
      );

      // Make sure waitDetails exists and has a scheduledTimestamp
      expect(result.operation.WaitDetails).toBeDefined();
      expect(result.operation.WaitDetails?.ScheduledTimestamp).toBeDefined();

      // Since we've already verified the timestamp exists and is a Date (earlier in this test),
      // we can now verify it's approximately 5 seconds in the future

      // Create a reference time just before we call the function to compare against
      const now = new Date().getTime();

      const timestamp = result.operation.WaitDetails?.ScheduledTimestamp;
      expect(timestamp).toBeInstanceOf(Date);

      const scheduledTime = timestamp instanceof Date ? timestamp.getTime() : 0;

      // Allow 1 second tolerance for test execution time
      expect(scheduledTime).toBeGreaterThan(now + 4000);
      expect(scheduledTime).toBeLessThan(now + 6000);
    });

    it("should return existing operation if it has waitDetails with scheduledTimestamp", () => {
      // First register a wait operation
      const waitUpdate: OperationUpdate = {
        Id: "wait-id",
        Type: OperationType.WAIT,
        Action: OperationAction.START,
        WaitOptions: {
          WaitSeconds: 5,
        },
      };
      const firstResult = storage.registerUpdate(waitUpdate, mockInvocationId);

      // Try to register it again
      const secondResult = storage.registerUpdate(waitUpdate, mockInvocationId);

      expect(secondResult).toBe(firstResult);
    });

    it("should add operation to pending updates", async () => {
      // Setup to capture the pending updates
      const pendingUpdatesPromise = storage.getPendingCheckpointUpdates();

      // Register an update
      const update: OperationUpdate = {
        Id: "test-update",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      };
      storage.registerUpdate(update, mockInvocationId);

      // Get the pending updates
      const pendingUpdates = await pendingUpdatesPromise;

      expect(pendingUpdates).toHaveLength(1);
      expect(pendingUpdates[0].update?.Id).toBe("test-update");
    });

    it.each([OperationAction.SUCCEED, OperationAction.FAIL])(
      "should add operation as completed if the action is %s",
      (action) => {
        const update: OperationUpdate = {
          Id: "step-id",
          Name: "test-step",
          Type: OperationType.STEP,
          Action: action,
        };

        const result = storage.registerUpdate(update, mockInvocationId);

        expect(result).toBeDefined();
        expect(result.operation.Id).toBe("step-id");
        expect(result.operation.Name).toBe("test-step");
        expect(result.operation.Type).toBe(OperationType.STEP);
        expect(result.operation.Status).toBe(
          action === OperationAction.SUCCEED
            ? OperationStatus.SUCCEEDED
            : OperationStatus.FAILED
        );
        expect(result.operation.StartTimestamp).toBeInstanceOf(Date);
        expect(result.operation.StepDetails).toEqual({});
        expect(result.operation.EndTimestamp).toBeInstanceOf(Date);

        expect(storage.operationDataMap.get("step-id")).toBe(result);
      }
    );
  });

  describe("retry functionality", () => {
    describe("completeOperation with retry", () => {
      it("should increment retry attempt when completing with RETRY action", () => {
        storage.initialize();

        // Register a step operation with initial retry attempt
        const stepUpdate: OperationUpdate = {
          Id: "retry-step",
          Type: OperationType.STEP,
          Action: OperationAction.RETRY,
        };
        storage.registerUpdate(stepUpdate, mockInvocationId);

        // Complete the operation with RETRY action
        const result = storage.completeOperation({
          Id: "retry-step",
          Action: OperationAction.RETRY,
          Payload: "retry result",
        });

        expect(result.operation.StepDetails?.Attempt).toBe(2); // 1 from register + 1 from complete
        expect(result.operation.StepDetails?.Result).toBe("retry result");
      });

      it("should preserve retry attempt when completing with non-RETRY action", () => {
        storage.initialize();

        // Register a step operation with existing retry attempts
        const stepUpdate: OperationUpdate = {
          Id: "success-step",
          Type: OperationType.STEP,
          Action: OperationAction.RETRY,
        };
        storage.registerUpdate(stepUpdate, mockInvocationId);

        // Complete with SUCCEED action (should preserve retry count)
        const result = storage.completeOperation({
          Id: "success-step",
          Action: OperationAction.SUCCEED,
          Payload: "final result",
        });

        expect(result.operation.StepDetails?.Attempt).toBe(1); // Preserved from register
        expect(result.operation.StepDetails?.Result).toBe("final result");
        expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED);
      });

      it("should handle retry increment when operation has no existing StepDetails", () => {
        storage.initialize();

        // Register a step operation without retry
        const stepUpdate: OperationUpdate = {
          Id: "new-retry-step",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        };
        storage.registerUpdate(stepUpdate, mockInvocationId);

        // Complete with RETRY action
        const result = storage.completeOperation({
          Id: "new-retry-step",
          Action: OperationAction.RETRY,
        });

        expect(result.operation.StepDetails?.Attempt).toBe(1); // 0 + 1
      });
    });

    describe("registerUpdate with retry", () => {
      it("should set retry attempt to 1 for first retry operation", () => {
        storage.initialize();

        const retryUpdate: OperationUpdate = {
          Id: "first-retry",
          Type: OperationType.STEP,
          Action: OperationAction.RETRY,
          Payload: "retry payload",
        };

        const result = storage.registerUpdate(retryUpdate, mockInvocationId);

        expect(result.operation.StepDetails?.Attempt).toBe(1);
        // Result should not be populated in registerUpdate, only in completeOperation
        expect(result.operation.StepDetails?.Result).toBeUndefined();
        expect(result.operation.Status).toBe(OperationStatus.PENDING);
      });

      it("should set retry attempt to 0 for non-retry operations", () => {
        storage.initialize();

        const normalUpdate: OperationUpdate = {
          Id: "normal-step",
          Type: OperationType.STEP,
          Action: OperationAction.SUCCEED,
          Payload: "normal payload",
        };

        const result = storage.registerUpdate(normalUpdate, mockInvocationId);

        expect(result.operation.StepDetails?.Attempt).toBeUndefined();
        expect(result.operation.StepDetails?.Result).toBe("normal payload");
      });

      it("should preserve existing retry attempt for operation without explicit retry attempt", () => {
        storage.initialize();

        // First register with retry
        const firstUpdate: OperationUpdate = {
          Id: "multi-retry",
          Type: OperationType.STEP,
          Action: OperationAction.RETRY,
        };
        storage.registerUpdate(firstUpdate, mockInvocationId);

        // Register again without retry action (simulating subsequent update)
        const secondUpdate: OperationUpdate = {
          Id: "multi-retry",
          Type: OperationType.STEP,
          Action: OperationAction.SUCCEED,
          Payload: "final result",
        };
        const result = storage.registerUpdate(secondUpdate, mockInvocationId);

        // Should complete the existing operation, preserving retry count
        expect(result.operation.StepDetails?.Attempt).toBe(1);
        expect(result.operation.StepDetails?.Result).toBe("final result");
        expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED);
      });

      it("should handle missing StepDetails when calculating retry attempt", () => {
        storage.initialize();

        const retryUpdate: OperationUpdate = {
          Id: "retry-no-details",
          Type: OperationType.STEP,
          Action: OperationAction.RETRY,
        };

        const result = storage.registerUpdate(retryUpdate, mockInvocationId);

        expect(result.operation.StepDetails?.Attempt).toBe(1); // Should default to 1 for retry
      });
    });

    describe("completeOperation with STEP operations and Error", () => {
      it("should update STEP operation with error", () => {
        storage.initialize();

        // Register a step operation
        const stepUpdate: OperationUpdate = {
          Id: "step-with-error",
          Action: OperationAction.START,
          Type: OperationType.STEP,
        };
        storage.registerUpdate(stepUpdate, mockInvocationId);

        // Complete the operation with error
        const result = storage.completeOperation({
          Id: "step-with-error",
          Action: OperationAction.FAIL,
          Error: {
            ErrorMessage: "Step execution failed",
            ErrorType: "StepExecutionError",
          },
        });

        expect(result.operation).toBeDefined();
        expect(result.operation.Status).toBe(OperationStatus.FAILED);
        expect(result.operation.EndTimestamp).toBeInstanceOf(Date);
        expect(result.operation.StepDetails?.Result).toBeUndefined();
        expect(result.operation.StepDetails?.Error).toEqual({
          ErrorMessage: "Step execution failed",
          ErrorType: "StepExecutionError",
        });
        expect(result.operation.StepDetails?.Attempt).toBeUndefined();
      });

      it("should update STEP operation with both result and error", () => {
        storage.initialize();

        // Register a step operation
        const stepUpdate: OperationUpdate = {
          Id: "step-partial",
          Action: OperationAction.START,
          Type: OperationType.STEP,
        };
        storage.registerUpdate(stepUpdate, mockInvocationId);

        // Complete the operation with both result and error
        const result = storage.completeOperation({
          Id: "step-partial",
          Action: OperationAction.FAIL,
          Payload: '{"partial": "data"}',
          Error: {
            ErrorMessage: "Partial failure occurred",
            ErrorType: "PartialFailure",
          },
        });

        expect(result.operation).toBeDefined();
        expect(result.operation.Status).toBe(OperationStatus.FAILED);
        expect(result.operation.StepDetails?.Result).toBe(
          '{"partial": "data"}'
        );
        expect(result.operation.StepDetails?.Error).toEqual({
          ErrorMessage: "Partial failure occurred",
          ErrorType: "PartialFailure",
        });
        expect(result.operation.StepDetails?.Attempt).toBeUndefined();
      });

      it("should update STEP operation with error during retry", () => {
        storage.initialize();

        // Register a step operation with retry
        const stepUpdate: OperationUpdate = {
          Id: "retry-step-error",
          Type: OperationType.STEP,
          Action: OperationAction.RETRY,
        };
        storage.registerUpdate(stepUpdate, mockInvocationId);

        // Complete the operation with error and another retry
        const result = storage.completeOperation({
          Id: "retry-step-error",
          Action: OperationAction.RETRY,
          Error: {
            ErrorMessage: "Retry attempt failed",
            ErrorType: "RetryError",
          },
        });

        expect(result.operation.StepDetails?.Attempt).toBe(2); // 1 from register + 1 from complete
        expect(result.operation.StepDetails?.Error).toEqual({
          ErrorMessage: "Retry attempt failed",
          ErrorType: "RetryError",
        });
        expect(result.operation.Status).toBe(OperationStatus.PENDING);
      });

      it("should handle STEP operation completion when original operation has no StepDetails", () => {
        storage.initialize();

        // Manually create an operation without StepDetails (edge case)
        const manualOperation = {
          operation: {
            Id: "manual-step",
            Type: OperationType.STEP,
            Status: OperationStatus.STARTED,
            StartTimestamp: new Date(),
          },
          update: {
            Id: "manual-step",
            Action: OperationAction.START,
            Type: OperationType.STEP,
          },
          events: [],
        };
        storage.operationDataMap.set("manual-step", manualOperation);

        // Complete the operation with error
        const result = storage.completeOperation({
          Id: "manual-step",
          Action: OperationAction.FAIL,
          Error: {
            ErrorMessage: "New error",
            ErrorType: "NewError",
          },
        });

        expect(result.operation.Status).toBe(OperationStatus.FAILED);
        expect(result.operation.StepDetails?.Error).toEqual({
          ErrorMessage: "New error",
          ErrorType: "NewError",
        });
        expect(result.operation.StepDetails?.Result).toBeUndefined();
        expect(result.operation.StepDetails?.Attempt).toBeUndefined();
      });
    });
  });

  describe("context functionality", () => {
    describe("registerUpdate with CONTEXT operations", () => {
      it("should create and register a new CONTEXT operation", () => {
        storage.initialize();

        const contextUpdate: OperationUpdate = {
          Id: "context-id",
          Name: "test-context",
          Action: OperationAction.START,
          Type: OperationType.CONTEXT,
          Payload: '{"userId": 123, "name": "John Doe"}',
        };

        const result = storage.registerUpdate(contextUpdate, mockInvocationId);

        expect(result).toBeDefined();
        expect(result.operation.Id).toBe("context-id");
        expect(result.operation.Name).toBe("test-context");
        expect(result.operation.Type).toBe(OperationType.CONTEXT);
        expect(result.operation.Status).toBe(OperationStatus.STARTED);
        expect(result.operation.StartTimestamp).toBeInstanceOf(Date);
        // ContextDetails should be populated in registerUpdate for CONTEXT operations
        expect(result.operation.ContextDetails).toEqual({
          ReplayChildren: undefined,
        });

        expect(storage.operationDataMap.get("context-id")).toBe(result);
      });

      it("should create CONTEXT operation with error", () => {
        storage.initialize();

        const contextUpdate: OperationUpdate = {
          Id: "context-with-error",
          Action: OperationAction.START,
          Type: OperationType.CONTEXT,
          Error: {
            ErrorMessage: "Context execution failed",
            ErrorType: "ContextError",
          },
        };

        const result = storage.registerUpdate(contextUpdate, mockInvocationId);

        expect(result).toBeDefined();
        expect(result.operation.Type).toBe(OperationType.CONTEXT);
        // ContextDetails should be populated in registerUpdate for CONTEXT operations
        expect(result.operation.ContextDetails).toEqual({
          ReplayChildren: undefined,
        });
      });

      it("should create CONTEXT operation with both result and error", () => {
        storage.initialize();

        const contextUpdate: OperationUpdate = {
          Id: "context-result-and-error",
          Action: OperationAction.START,
          Type: OperationType.CONTEXT,
          Payload: '{"partial": "result"}',
          Error: {
            ErrorMessage: "Partial failure",
            ErrorType: "PartialError",
          },
        };

        const result = storage.registerUpdate(contextUpdate, mockInvocationId);

        expect(result).toBeDefined();
        expect(result.operation.Type).toBe(OperationType.CONTEXT);
        // ContextDetails should be populated in registerUpdate
        expect(result.operation.ContextDetails).toEqual({
          ReplayChildren: undefined,
        });
      });

      it("should handle CONTEXT operation with undefined payload and error", () => {
        storage.initialize();

        const contextUpdate: OperationUpdate = {
          Id: "context-empty",
          Action: OperationAction.START,
          Type: OperationType.CONTEXT,
          Payload: undefined,
          Error: undefined,
        };

        const result = storage.registerUpdate(contextUpdate, mockInvocationId);

        expect(result).toBeDefined();
        expect(result.operation.Type).toBe(OperationType.CONTEXT);
        // ContextDetails should be populated in registerUpdate
        expect(result.operation.ContextDetails).toEqual({
          ReplayChildren: undefined,
        });
      });

      it.each([OperationAction.SUCCEED, OperationAction.FAIL])(
        "should add CONTEXT operation as completed if the action is %s",
        (action) => {
          storage.initialize();

          const contextUpdate: OperationUpdate = {
            Id: "completed-context",
            Name: "test-context",
            Type: OperationType.CONTEXT,
            Action: action,
            Payload: '{"result": "data"}',
          };

          const result = storage.registerUpdate(
            contextUpdate,
            mockInvocationId
          );

          expect(result).toBeDefined();
          expect(result.operation.Id).toBe("completed-context");
          expect(result.operation.Type).toBe(OperationType.CONTEXT);
          expect(result.operation.Status).toBe(
            action === OperationAction.SUCCEED
              ? OperationStatus.SUCCEEDED
              : OperationStatus.FAILED
          );
          expect(result.operation.StartTimestamp).toBeInstanceOf(Date);
          expect(result.operation.ContextDetails).toEqual({
            Result: '{"result": "data"}',
            Error: undefined,
          });
          expect(result.operation.EndTimestamp).toBeInstanceOf(Date);

          expect(storage.operationDataMap.get("completed-context")).toBe(
            result
          );
        }
      );
    });

    describe("completeOperation with CONTEXT operations", () => {
      it("should update CONTEXT operation with new result", () => {
        storage.initialize();

        // Register a context operation
        const contextUpdate: OperationUpdate = {
          Id: "context-to-complete",
          Action: OperationAction.START,
          Type: OperationType.CONTEXT,
          Payload: '{"initial": "result"}',
        };
        storage.registerUpdate(contextUpdate, mockInvocationId);

        // Complete the operation with new result
        const result = storage.completeOperation({
          Id: "context-to-complete",
          Action: OperationAction.SUCCEED,
          Payload: '{"final": "result"}',
        });

        expect(result.operation).toBeDefined();
        expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED);
        expect(result.operation.EndTimestamp).toBeInstanceOf(Date);
        expect(result.operation.ContextDetails?.Result).toBe(
          '{"final": "result"}'
        );
        expect(result.operation.ContextDetails?.Error).toBeUndefined();
      });

      it("should update CONTEXT operation with error", () => {
        storage.initialize();

        // Register a context operation
        const contextUpdate: OperationUpdate = {
          Id: "context-to-fail",
          Action: OperationAction.START,
          Type: OperationType.CONTEXT,
          Payload: '{"initial": "result"}',
        };
        storage.registerUpdate(contextUpdate, mockInvocationId);

        // Complete the operation with error
        const result = storage.completeOperation({
          Id: "context-to-fail",
          Action: OperationAction.FAIL,
          Error: {
            ErrorMessage: "Context execution failed",
            ErrorType: "ContextExecutionError",
          },
        });

        expect(result.operation).toBeDefined();
        expect(result.operation.Status).toBe(OperationStatus.FAILED);
        expect(result.operation.EndTimestamp).toBeInstanceOf(Date);
        expect(result.operation.ContextDetails?.Result).toBeUndefined();
        expect(result.operation.ContextDetails?.Error).toEqual({
          ErrorMessage: "Context execution failed",
          ErrorType: "ContextExecutionError",
        });
      });

      it("should update CONTEXT operation with both result and error", () => {
        storage.initialize();

        // Register a context operation
        const contextUpdate: OperationUpdate = {
          Id: "context-partial",
          Action: OperationAction.START,
          Type: OperationType.CONTEXT,
        };
        storage.registerUpdate(contextUpdate, mockInvocationId);

        // Complete the operation with both result and error
        const result = storage.completeOperation({
          Id: "context-partial",
          Action: OperationAction.FAIL,
          Payload: '{"partial": "data"}',
          Error: {
            ErrorMessage: "Partial failure occurred",
            ErrorType: "PartialFailure",
          },
        });

        expect(result.operation).toBeDefined();
        expect(result.operation.Status).toBe(OperationStatus.FAILED);
        expect(result.operation.ContextDetails?.Result).toBe(
          '{"partial": "data"}'
        );
        expect(result.operation.ContextDetails?.Error).toEqual({
          ErrorMessage: "Partial failure occurred",
          ErrorType: "PartialFailure",
        });
      });

      it("should handle CONTEXT operation completion when original operation has no ContextDetails", () => {
        storage.initialize();

        // Manually create an operation without ContextDetails (edge case)
        const manualOperation = {
          operation: {
            Id: "manual-context",
            Type: OperationType.CONTEXT,
            Status: OperationStatus.STARTED,
            StartTimestamp: new Date(),
          },
          update: {
            Id: "manual-context",
            Action: OperationAction.START,
            Type: OperationType.CONTEXT,
          },
          events: [],
        };
        storage.operationDataMap.set("manual-context", manualOperation);

        // Complete the operation
        const result = storage.completeOperation({
          Id: "manual-context",
          Action: OperationAction.SUCCEED,
          Payload: '{"new": "result"}',
        });

        expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED);
        expect(result.operation.ContextDetails?.Result).toBe(
          '{"new": "result"}'
        );
        expect(result.operation.ContextDetails?.Error).toBeUndefined();
      });
    });
  });

  describe("callback functionality", () => {
    describe("registerUpdate with CALLBACK operations", () => {
      it("should create CALLBACK operation and delegate to CallbackManager", () => {
        storage.initialize();

        const callbackUpdate: OperationUpdate = {
          Id: "callback-op",
          Name: "test-callback",
          Type: OperationType.CALLBACK,
          Action: OperationAction.START,
          CallbackOptions: {
            TimeoutSeconds: 30,
            HeartbeatTimeoutSeconds: 60,
          },
        };

        const result = storage.registerUpdate(callbackUpdate, mockInvocationId);

        expect(result).toBeDefined();
        expect(result.operation.Id).toBe("callback-op");
        expect(result.operation.Type).toBe(OperationType.CALLBACK);
        expect(result.operation.Status).toBe(OperationStatus.STARTED);
        expect(result.operation.CallbackDetails?.CallbackId).toBeDefined();
      });

      it("should create CALLBACK operation without timeout options", () => {
        storage.initialize();

        const callbackUpdate: OperationUpdate = {
          Id: "simple-callback",
          Action: OperationAction.START,
          Type: OperationType.CALLBACK,
        };

        const result = storage.registerUpdate(callbackUpdate, mockInvocationId);

        expect(result).toBeDefined();
        expect(result.operation.Type).toBe(OperationType.CALLBACK);
        expect(result.operation.CallbackDetails?.CallbackId).toBeDefined();
      });

      it("should handle CALLBACK operation with only timeout", () => {
        storage.initialize();

        const callbackUpdate: OperationUpdate = {
          Id: "timeout-callback",
          Type: OperationType.CALLBACK,
          Action: OperationAction.START,
          CallbackOptions: {
            TimeoutSeconds: 30,
          },
        };

        const result = storage.registerUpdate(callbackUpdate, mockInvocationId);

        expect(result).toBeDefined();
        expect(result.operation.Type).toBe(OperationType.CALLBACK);
        expect(result.operation.CallbackDetails?.CallbackId).toBeDefined();
      });

      it("should handle CALLBACK operation with only heartbeat timeout", () => {
        storage.initialize();

        const callbackUpdate: OperationUpdate = {
          Id: "heartbeat-callback",
          Type: OperationType.CALLBACK,
          Action: OperationAction.START,
          CallbackOptions: {
            HeartbeatTimeoutSeconds: 60,
          },
        };

        const result = storage.registerUpdate(callbackUpdate, mockInvocationId);

        expect(result).toBeDefined();
        expect(result.operation.Type).toBe(OperationType.CALLBACK);
        expect(result.operation.CallbackDetails?.CallbackId).toBeDefined();
      });
    });
  });

  describe("completeCallback", () => {
    beforeEach(() => {
      // Set up some mock callback operation data with proper callback ID
      const mockCallbackId = Buffer.from(
        JSON.stringify({
          executionId: "test-execution-id",
          operationId: "test-callback-op",
          token: "test-token",
        })
      ).toString("base64");

      const mockCallbackOperation = {
        operation: {
          Id: "test-callback-op",
          Type: OperationType.CALLBACK,
          Status: OperationStatus.STARTED,
          CallbackDetails: {
            CallbackId: mockCallbackId,
          },
        },
        update: {
          Id: "test-callback-op",
          Action: OperationAction.START,
          Type: OperationType.CALLBACK,
        },
        events: [],
      };
      storage.operationDataMap.set("test-callback-op", mockCallbackOperation);
    });

    it("should delegate to callback manager and update operation data map", () => {
      // Create a realistic callback ID that can be decoded
      const mockCallbackId = Buffer.from(
        JSON.stringify({
          executionId: "test-execution-id",
          operationId: "test-callback-op",
          token: "test-token",
        })
      ).toString("base64");

      const callbackDetails = {
        CallbackId: mockCallbackId,
        Result: "test-result",
      };

      // The actual implementation will call the callback manager internally
      // and should handle the operation data map update
      expect(() => {
        storage.completeCallback(
          callbackDetails,
          CompleteCallbackStatus.SUCCEEDED
        );
      }).not.toThrow();
    });

    it("should handle callback completion with error", () => {
      // Create a realistic callback ID that can be decoded
      const mockCallbackId = Buffer.from(
        JSON.stringify({
          executionId: "test-execution-id",
          operationId: "test-callback-op",
          token: "test-token",
        })
      ).toString("base64");

      const callbackDetails = {
        CallbackId: mockCallbackId,
        Error: {
          ErrorMessage: "Test error",
          ErrorType: "TestError",
        },
      };

      expect(() => {
        storage.completeCallback(
          callbackDetails,
          CompleteCallbackStatus.FAILED
        );
      }).not.toThrow();
    });
  });

  describe("integration with CallbackManager", () => {
    it("should provide correct interface to CallbackManager", () => {
      // Test that CheckpointManager provides the expected interface
      const checkpointManager = storage;

      // Should have operationDataMap
      expect(checkpointManager.operationDataMap).toBeDefined();
      expect(checkpointManager.operationDataMap).toBeInstanceOf(Map);

      // Should have addOperationUpdate method
      expect(checkpointManager.addOperationUpdate).toBeDefined();
      expect(typeof checkpointManager.addOperationUpdate).toBe("function");

      // Should have completeCallback method for callback management
      expect(checkpointManager.completeCallback).toBeDefined();
      expect(typeof checkpointManager.completeCallback).toBe("function");
    });

    it("should handle CallbackManager notifications", async () => {
      storage.initialize();

      // Create a mock operation for the callback manager to work with
      const mockOperation = {
        operation: {
          Id: "test-op",
          Type: OperationType.CALLBACK,
          Status: OperationStatus.STARTED,
        },
        update: {
          Id: "test-op",
          Action: OperationAction.START,
          Type: OperationType.CALLBACK,
        },
        events: [],
      };
      storage.operationDataMap.set("test-op", mockOperation);

      // Directly call addOperationUpdate to simulate CallbackManager notification
      storage.addOperationUpdate(mockOperation);

      // Should be able to get pending updates
      const pendingUpdates = await storage.getPendingCheckpointUpdates();
      expect(pendingUpdates).toHaveLength(1);
      expect(pendingUpdates[0]).toBe(mockOperation);
    });
  });

  describe("markOperationCompleted", () => {
    it("should mark operation as completed with specified status", () => {
      const initialOperation = storage.initialize();

      const completedOperation = storage.markOperationCompleted(
        initialOperation,
        OperationStatus.SUCCEEDED
      );

      expect(completedOperation).not.toBe(initialOperation); // Should be a new object
      expect(completedOperation.Id).toBe(initialOperation.Id);
      expect(completedOperation.Status).toBe(OperationStatus.SUCCEEDED);
      expect(completedOperation.EndTimestamp).toBeInstanceOf(Date);
    });

    it("should mark operation as failed", () => {
      const initialOperation = storage.initialize();

      const failedOperation = storage.markOperationCompleted(
        initialOperation,
        OperationStatus.FAILED
      );

      expect(failedOperation.Status).toBe(OperationStatus.FAILED);
      expect(failedOperation.EndTimestamp).toBeInstanceOf(Date);
    });

    it("should mark operation as timed out", () => {
      const initialOperation = storage.initialize();

      const timedOutOperation = storage.markOperationCompleted(
        initialOperation,
        OperationStatus.TIMED_OUT
      );

      expect(timedOutOperation.Status).toBe(OperationStatus.TIMED_OUT);
      expect(timedOutOperation.EndTimestamp).toBeInstanceOf(Date);
    });

    it("should preserve all original operation properties", () => {
      const originalOperation = {
        Id: "test-op",
        Name: "test-operation",
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
        Status: OperationStatus.STARTED,
        StepDetails: {
          Attempt: 2,
          Result: "partial-result",
        },
      };

      const completedOperation = storage.markOperationCompleted(
        originalOperation,
        OperationStatus.SUCCEEDED
      );

      expect(completedOperation.Id).toBe(originalOperation.Id);
      expect(completedOperation.Name).toBe(originalOperation.Name);
      expect(completedOperation.Type).toBe(originalOperation.Type);
      expect(completedOperation.StartTimestamp).toBe(
        originalOperation.StartTimestamp
      );
      expect(completedOperation.StepDetails).toEqual(
        originalOperation.StepDetails
      );
      expect(completedOperation.Status).toBe(OperationStatus.SUCCEEDED);
      expect(completedOperation.EndTimestamp).toBeInstanceOf(Date);
    });
  });

  describe("registerUpdates", () => {
    it("should register multiple updates and return array of CheckpointOperations", () => {
      storage.initialize();

      const updates: OperationUpdate[] = [
        {
          Id: "batch-op-1",
          Type: OperationType.STEP,
          Action: OperationAction.START,
          Payload: "result1",
        },
        {
          Id: "batch-op-2",
          Type: OperationType.WAIT,
          Action: OperationAction.START,
          WaitOptions: { WaitSeconds: 5 },
        },
        {
          Id: "batch-op-3",
          Type: OperationType.STEP,
          Action: OperationAction.SUCCEED,
          Payload: "result3",
        },
      ];

      const results = storage.registerUpdates(updates, mockInvocationId);

      expect(results).toHaveLength(3);
      expect(results[0].operation.Id).toBe("batch-op-1");
      expect(results[0].operation.Type).toBe(OperationType.STEP);
      expect(results[1].operation.Id).toBe("batch-op-2");
      expect(results[1].operation.Type).toBe(OperationType.WAIT);
      expect(results[2].operation.Id).toBe("batch-op-3");
      expect(results[2].operation.Type).toBe(OperationType.STEP);
      expect(results[2].operation.Status).toBe(OperationStatus.SUCCEEDED);

      // Verify all operations are stored
      expect(storage.hasOperation("batch-op-1")).toBe(true);
      expect(storage.hasOperation("batch-op-2")).toBe(true);
      expect(storage.hasOperation("batch-op-3")).toBe(true);
    });

    it("should handle empty updates array", () => {
      storage.initialize();

      const results = storage.registerUpdates([], mockInvocationId);

      expect(results).toHaveLength(0);
      expect(results).toEqual([]);
    });

    it("should handle single update in array", () => {
      storage.initialize();

      const updates: OperationUpdate[] = [
        {
          Id: "single-op",
          Type: OperationType.STEP,
          Payload: "single-result",
          Action: OperationAction.START,
        },
      ];

      const results = storage.registerUpdates(updates, mockInvocationId);

      expect(results).toHaveLength(1);
      expect(results[0].operation.Id).toBe("single-op");
      expect(results[0].operation.Type).toBe(OperationType.STEP);
      expect(storage.hasOperation("single-op")).toBe(true);
    });

    it("should maintain order of operations in results", () => {
      storage.initialize();

      const updates: OperationUpdate[] = [
        { Id: "op-z", Type: OperationType.STEP, Action: OperationAction.START },
        {
          Id: "op-a",
          Type: OperationType.WAIT,
          Action: OperationAction.START,
          WaitOptions: { WaitSeconds: 1 },
        },
        { Id: "op-m", Type: OperationType.STEP, Action: OperationAction.START },
      ];

      const results = storage.registerUpdates(updates, mockInvocationId);

      expect(results[0].operation.Id).toBe("op-z");
      expect(results[1].operation.Id).toBe("op-a");
      expect(results[2].operation.Id).toBe("op-m");
    });
  });

  describe("updateOperation", () => {
    it("should update existing operation and return the updated CheckpointOperation", () => {
      const initialOperation = storage.initialize();

      const newOperationData = {
        Status: OperationStatus.SUCCEEDED,
        EndTimestamp: new Date(),
      };

      const result = storage.updateOperation(
        initialOperation.Id,
        newOperationData
      );

      // Should return the updated CheckpointOperation
      expect(result.operation.Id).toBe(initialOperation.Id);
      expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED); // Updated status
      expect(result.operation.EndTimestamp).toEqual(
        newOperationData.EndTimestamp
      );

      // And the stored operation should be the same as returned
      const storedOperation = storage.operationDataMap.get(initialOperation.Id);
      expect(storedOperation).toBe(result);
      expect(storedOperation?.operation.Status).toBe(OperationStatus.SUCCEEDED);
      expect(storedOperation?.operation.EndTimestamp).toEqual(
        newOperationData.EndTimestamp
      );
    });

    it("should preserve existing operation properties when updating", () => {
      const initialOperation = storage.initialize();
      const originalType = initialOperation.Type;
      const originalExecutionDetails = initialOperation.ExecutionDetails;

      const newOperationData = {
        Status: OperationStatus.FAILED,
        SomeNewField: "new-value",
      };

      storage.updateOperation(initialOperation.Id, newOperationData);

      const storedOperation = storage.operationDataMap.get(initialOperation.Id);
      expect(storedOperation?.operation.Type).toBe(originalType);
      expect(storedOperation?.operation.ExecutionDetails).toBe(
        originalExecutionDetails
      );
      expect(storedOperation?.operation.Status).toBe(OperationStatus.FAILED);
      expect(
        (storedOperation?.operation as Record<string, unknown>).SomeNewField
      ).toBe("new-value");
    });

    it("should handle partial operation updates", () => {
      storage.initialize();

      // Register a step operation first
      const stepUpdate: OperationUpdate = {
        Id: "step-to-update",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        Name: "test-step",
      };
      storage.registerUpdate(stepUpdate, mockInvocationId);

      const partialUpdate = {
        Status: OperationStatus.SUCCEEDED,
      };

      const result = storage.updateOperation("step-to-update", partialUpdate);

      expect(result.operation.Id).toBe("step-to-update");
      expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED); // Updated

      // Check stored operation is the same as returned
      const storedOperation = storage.operationDataMap.get("step-to-update");
      expect(storedOperation).toBe(result);
      expect(storedOperation?.operation.Status).toBe(OperationStatus.SUCCEEDED);
      expect(storedOperation?.operation.Name).toBe("test-step"); // Preserved
      expect(storedOperation?.operation.Type).toBe(OperationType.STEP); // Preserved
    });

    it("should throw error for non-existent operation", () => {
      storage.initialize();

      expect(() => {
        storage.updateOperation("non-existent-id", {
          Status: OperationStatus.SUCCEEDED,
        });
      }).toThrow("Could not find operation");
    });

    it("should handle complex operation updates", () => {
      storage.initialize();

      // Register a complex operation
      const complexUpdate: OperationUpdate = {
        Id: "complex-op",
        Action: OperationAction.START,
        Type: OperationType.STEP,
        Name: "complex-step",
        Payload: "initial-payload",
      };
      storage.registerUpdate(complexUpdate, mockInvocationId);

      const updateData = {
        Status: OperationStatus.SUCCEEDED,
        EndTimestamp: new Date(),
        StepDetails: {
          Result: "final-result",
          Attempt: 1,
        },
      };

      const result = storage.updateOperation("complex-op", updateData);

      // Updated operation returned
      expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED);
      expect(result.operation.StepDetails).toEqual({
        Result: "final-result",
        Attempt: 1,
      });
      expect(result.operation.EndTimestamp).toEqual(updateData.EndTimestamp);

      // Stored operation should be the same as returned
      const storedOperation = storage.operationDataMap.get("complex-op");
      expect(storedOperation).toBe(result);
      expect(storedOperation?.operation.Status).toBe(OperationStatus.SUCCEEDED);
      expect(storedOperation?.operation.StepDetails).toEqual({
        Result: "final-result",
        Attempt: 1,
      });
      expect(storedOperation?.operation.EndTimestamp).toEqual(
        updateData.EndTimestamp
      );
    });

    it("should handle updates with undefined or null values", () => {
      const initialOperation = storage.initialize();

      const updateWithUndefined = {
        Status: OperationStatus.SUCCEEDED,
        SomeField: undefined,
        AnotherField: null,
      };

      storage.updateOperation(initialOperation.Id, updateWithUndefined);

      const storedOperation = storage.operationDataMap.get(initialOperation.Id);
      expect(storedOperation?.operation.Status).toBe(OperationStatus.SUCCEEDED);
      expect(
        (storedOperation?.operation as Record<string, unknown>).SomeField
      ).toBeUndefined();
      expect(
        (storedOperation?.operation as Record<string, unknown>).AnotherField
      ).toBeNull();
    });
  });

  describe("getState", () => {
    it("should return empty array when no operations exist", () => {
      const state = storage.getState();
      expect(state).toEqual([]);
    });

    it("should return single operation when only one exists", () => {
      const initialOperation = storage.initialize();

      const state = storage.getState();

      expect(state).toHaveLength(1);
      expect(state[0]).toEqual(initialOperation);
    });

    it("should return all operations when no parent-child relationships exist", () => {
      storage.initialize();

      // Add some operations without parent relationships
      const update1: OperationUpdate = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      };
      const update2: OperationUpdate = {
        Id: "op2",
        Type: OperationType.WAIT,
        Action: OperationAction.START,
        WaitOptions: { WaitSeconds: 1 },
      };

      storage.registerUpdate(update1, mockInvocationId);
      storage.registerUpdate(update2, mockInvocationId);

      const state = storage.getState();

      expect(state).toHaveLength(3); // initial + 2 registered
      expect(state.map((op) => op.Id)).toContain("op1");
      expect(state.map((op) => op.Id)).toContain("op2");
    });

    it("should handle comprehensive operation tree with all pruning scenarios", () => {
      storage.initialize();

      const updates: OperationUpdate[] = [
        // Step with no parent
        {
          Id: "1-step",
          Type: OperationType.STEP,
          Action: OperationAction.SUCCEED,
        },
        // In-progress context
        {
          Id: "2-context",
          Type: OperationType.CONTEXT,
          Action: OperationAction.START,
        },
        // In-progress step in in-progress context
        {
          Id: "2.1-step",
          ParentId: "2-context",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        },
        // Step with non-existent parent (shouldn't happen but we handle it)
        {
          Id: "3-step",
          ParentId: "does-not-exist",
          Type: OperationType.STEP,
          Action: OperationAction.SUCCEED,
        },
        // Failed context, no explicit ReplayChildren=true (defaults to false/undefined)
        {
          Id: "4-context",
          Type: OperationType.CONTEXT,
          Action: OperationAction.FAIL,
        },
        // Failed context, explicit ReplayChildren=true, but inside one that's already completed so should be pruned
        {
          Id: "4.1-context",
          ParentId: "4-context",
          Type: OperationType.CONTEXT,
          ContextOptions: {
            ReplayChildren: true,
          },
          Action: OperationAction.FAIL,
        },
        // Failed step, should get pruned as its top ancestor has ReplayChildren=false
        {
          Id: "4.1.1-step",
          ParentId: "4.1-context",
          Type: OperationType.STEP,
          Action: OperationAction.FAIL,
        },
        // Failed step, should get pruned as its top ancestor has ReplayChildren=false
        {
          Id: "4.1.2-step",
          ParentId: "4.1-context",
          Type: OperationType.STEP,
          Action: OperationAction.FAIL,
        },
        // Succeeded context with explicit ReplayChildren=true
        {
          Id: "5-context",
          Type: OperationType.CONTEXT,
          ContextOptions: {
            ReplayChildren: true,
          },
          Action: OperationAction.SUCCEED,
        },
        // Should not get pruned
        {
          Id: "5.1-context",
          ParentId: "5-context",
          Type: OperationType.CONTEXT,
          ContextOptions: {
            ReplayChildren: false,
          },
          Action: OperationAction.SUCCEED,
        },
        // Should get pruned (inside completed context with ReplayChildren=false)
        {
          Id: "5.1.1-step",
          ParentId: "5.1-context",
          Type: OperationType.STEP,
          Action: OperationAction.SUCCEED,
        },
        // Should not get pruned
        {
          Id: "5.1-step",
          ParentId: "5-context",
          Type: OperationType.STEP,
          Action: OperationAction.SUCCEED,
        },
      ];

      storage.registerUpdates(updates, mockInvocationId);

      const state = storage.getState();

      const expectedOperations = [
        "mocked-uuid", // initial operation
        "1-step",
        "2-context",
        "2.1-step",
        "3-step", // orphan with non-existent parent gets included
        "4-context",
        "5-context",
        "5.1-context",
        "5.1-step",
      ];

      expect(state).toHaveLength(expectedOperations.length);

      const stateIds = state.map((op) => op.Id);
      // Verify expected operations are present
      expectedOperations.forEach((expectedId) => {
        expect(stateIds).toContain(expectedId);
      });

      // Verify pruned operations are not present
      const prunedOperations = [
        "4.1-context",
        "4.1.1-step",
        "4.1.2-step",
        "5.1.1-step",
      ];
      prunedOperations.forEach((prunedId) => {
        expect(state.find((op) => op.Id === prunedId)).toBeUndefined();
      });
    });
  });

  describe("invocation tracking", () => {
    describe("getOperationInvocationIdMap", () => {
      it("should return empty map initially", () => {
        const map = storage.getOperationInvocationIdMap();
        expect(map).toEqual({});
      });

      it("should return operations associated with invocations", () => {
        storage.initialize();

        const invocationId1 = createInvocationId("invocation-1");
        const invocationId2 = createInvocationId("invocation-2");

        // Register operations with invocations
        const update1: OperationUpdate = {
          Id: "op1",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        };
        storage.registerUpdate(update1, invocationId1);

        const update2: OperationUpdate = {
          Id: "op2",
          Type: OperationType.WAIT,
          WaitOptions: { WaitSeconds: 1 },
          Action: OperationAction.START,
        };
        storage.registerUpdate(update2, invocationId2);

        const map = storage.getOperationInvocationIdMap();

        expect(map).toEqual({
          op1: [invocationId1],
          op2: [invocationId2],
        });
      });

      it("should convert Set to Array for invocation IDs", () => {
        storage.initialize();

        const invocationId = createInvocationId("test-invocation");

        const update: OperationUpdate = {
          Id: "test-op",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        };
        storage.registerUpdate(update, invocationId);

        const map = storage.getOperationInvocationIdMap();

        expect(Array.isArray(map["test-op"])).toBe(true);
        expect(map["test-op"]).toEqual([invocationId]);
      });
    });

    describe("registerUpdate with invocation tracking", () => {
      it("should track invocation for new operations", () => {
        storage.initialize();

        const invocationId = createInvocationId("new-op-invocation");

        const update: OperationUpdate = {
          Id: "new-tracked-op",
          Action: OperationAction.START,
          Type: OperationType.STEP,
        };

        storage.registerUpdate(update, invocationId);

        const map = storage.getOperationInvocationIdMap();
        expect(map["new-tracked-op"]).toEqual([invocationId]);
      });

      it("should add invocation to existing operation", () => {
        storage.initialize();

        const invocationId1 = createInvocationId("first-invocation");
        const invocationId2 = createInvocationId("second-invocation");

        const update: OperationUpdate = {
          Id: "existing-op",
          Action: OperationAction.START,
          Type: OperationType.STEP,
        };

        // First registration
        storage.registerUpdate(update, invocationId1);

        // Second registration should add to existing operation
        const update2: OperationUpdate = {
          Id: "existing-op",
          Type: OperationType.STEP,
          Action: OperationAction.SUCCEED,
        };
        storage.registerUpdate(update2, invocationId2);

        const map = storage.getOperationInvocationIdMap();
        expect(map["existing-op"]).toContain(invocationId1);
        expect(map["existing-op"]).toContain(invocationId2);
      });
    });
  });
});
