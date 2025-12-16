import { CheckpointManager } from "../checkpoint-manager";
import {
  createExecutionId,
  createInvocationId,
} from "../../utils/tagged-strings";
import {
  OperationUpdate,
  OperationType,
  OperationAction,
  OperationStatus,
} from "@aws-sdk/client-lambda";
import { CompleteCallbackStatus } from "../callback-manager";

// Mock crypto's randomUUID function
jest.mock("node:crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("mocked-uuid"),
}));

describe("CheckpointManager dirty operation tracking", () => {
  let storage: CheckpointManager;

  beforeEach(() => {
    storage = new CheckpointManager(createExecutionId("test-execution-id"));
    jest.clearAllMocks();
  });

  afterEach(() => {
    storage.cleanup();
  });

  describe("dirty operation tracking", () => {
    describe("getDirtyOperations", () => {
      it("should return empty array when no operations are dirty", () => {
        storage.initialize();

        const dirtyOperations = storage.getDirtyOperations();

        expect(dirtyOperations).toEqual([]);
        expect(storage.hasDirtyOperations()).toBe(false);
      });

      it("should return dirty operations and clear the dirty set", () => {
        storage.initialize();
        const stepUpdate: OperationUpdate = {
          Id: "dirty-step",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        };
        storage.registerUpdate(stepUpdate);

        const firstCall = storage.getDirtyOperations();
        expect(firstCall).toHaveLength(1);
        expect(firstCall[0].Id).toBe("dirty-step");

        expect(storage.hasDirtyOperations()).toBe(false);

        const secondCall = storage.getDirtyOperations();
        expect(secondCall).toEqual([]);
        expect(storage.hasDirtyOperations()).toBe(false);
      });

      it("should return multiple dirty operations in correct order", () => {
        storage.initialize();
        const updates: OperationUpdate[] = [
          {
            Id: "first-op",
            Type: OperationType.STEP,
            Action: OperationAction.START,
          },
          {
            Id: "second-op",
            Type: OperationType.WAIT,
            Action: OperationAction.START,
            WaitOptions: { WaitSeconds: 5 },
          },
          {
            Id: "third-op",
            Type: OperationType.STEP,
            Action: OperationAction.SUCCEED,
            Payload: "result",
          },
        ];
        storage.registerUpdates(updates);

        const dirtyOperations = storage.getDirtyOperations();

        expect(dirtyOperations).toHaveLength(3);
        expect(dirtyOperations.map((op) => op.Id)).toEqual([
          "first-op",
          "second-op",
          "third-op",
        ]);
        expect(storage.hasDirtyOperations()).toBe(false);
      });
    });

    describe("startInvocation clears dirty operations", () => {
      it("should clear dirty operations when starting new invocation", () => {
        storage.initialize();
        const stepUpdate: OperationUpdate = {
          Id: "pre-invocation-op",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        };
        storage.registerUpdate(stepUpdate);

        // Verify operation is dirty before invocation
        expect(storage.hasDirtyOperations()).toBe(true);
        const dirtyBefore = storage.getDirtyOperations();
        expect(dirtyBefore).toHaveLength(1);
        expect(storage.hasDirtyOperations()).toBe(false);

        // Start new invocation should clear dirty set
        const invocationId = createInvocationId("test-invocation");
        storage.startInvocation(invocationId);
        expect(storage.hasDirtyOperations()).toBe(false);

        // Verify dirty set is cleared after invocation
        const dirtyAfter = storage.getDirtyOperations();
        expect(dirtyAfter).toEqual([]);
        expect(storage.hasDirtyOperations()).toBe(false);
      });

      it("should return all operations from startInvocation", () => {
        const initialOp = storage.initialize();
        const stepUpdate: OperationUpdate = {
          Id: "existing-op",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        };
        storage.registerUpdate(stepUpdate);

        const invocationId = createInvocationId("test-invocation");
        const allOperations = storage.startInvocation(invocationId);

        expect(allOperations).toHaveLength(2);
        expect(allOperations.map((op) => op.operation.Id)).toContain(
          initialOp.operation.Id,
        );
        expect(allOperations.map((op) => op.operation.Id)).toContain(
          "existing-op",
        );
      });
    });

    describe("operations marked dirty through different paths", () => {
      it("should mark operations dirty when registered through registerUpdate", () => {
        storage.initialize();
        const stepUpdate: OperationUpdate = {
          Id: "register-op",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        };

        storage.registerUpdate(stepUpdate);

        const dirtyOperations = storage.getDirtyOperations();
        expect(dirtyOperations).toHaveLength(1);
        expect(dirtyOperations[0].Id).toBe("register-op");
      });

      it("should mark operations dirty when registered through registerUpdates", () => {
        storage.initialize();
        const updates: OperationUpdate[] = [
          {
            Id: "batch-op-1",
            Type: OperationType.STEP,
            Action: OperationAction.START,
          },
          {
            Id: "batch-op-2",
            Type: OperationType.WAIT,
            Action: OperationAction.START,
            WaitOptions: { WaitSeconds: 3 },
          },
        ];

        storage.registerUpdates(updates);

        const dirtyOperations = storage.getDirtyOperations();
        expect(dirtyOperations).toHaveLength(2);
        expect(dirtyOperations.map((op) => op.Id)).toEqual([
          "batch-op-1",
          "batch-op-2",
        ]);
      });

      it("should mark operations dirty when completed through completeCallback", () => {
        storage.initialize();
        const callbackUpdate: OperationUpdate = {
          Id: "callback-to-complete",
          Type: OperationType.CALLBACK,
          Action: OperationAction.START,
        };
        storage.registerUpdate(callbackUpdate);

        // Clear the dirty set from registration
        storage.getDirtyOperations();

        // Create a realistic callback ID that can be decoded
        const mockCallbackId = Buffer.from(
          JSON.stringify({
            executionId: "test-execution-id",
            operationId: "callback-to-complete",
            token: "test-token",
          }),
        ).toString("base64");

        const callbackDetails = {
          CallbackId: mockCallbackId,
          Result: "callback-result",
        };

        storage.completeCallback(
          callbackDetails,
          CompleteCallbackStatus.SUCCEEDED,
        );

        const dirtyOperations = storage.getDirtyOperations();
        expect(dirtyOperations).toHaveLength(1);
        expect(dirtyOperations[0].Id).toBe("callback-to-complete");
        expect(dirtyOperations[0].Status).toBe(OperationStatus.SUCCEEDED);
      });

      it("should mark operations dirty when updated through updateOperation", () => {
        storage.initialize();
        const waitUpdate: OperationUpdate = {
          Id: "wait-to-update",
          Type: OperationType.WAIT,
          Action: OperationAction.START,
          WaitOptions: { WaitSeconds: 10 },
        };
        storage.registerUpdate(waitUpdate);

        // Clear the dirty set from registration
        storage.getDirtyOperations();

        // Update the operation
        storage.updateOperation(
          "wait-to-update",
          { Status: OperationStatus.SUCCEEDED },
          undefined,
          undefined,
        );

        const dirtyOperations = storage.getDirtyOperations();
        expect(dirtyOperations).toHaveLength(1);
        expect(dirtyOperations[0].Id).toBe("wait-to-update");
        expect(dirtyOperations[0].Status).toBe(OperationStatus.SUCCEEDED);
      });
    });

    describe("sequential checkpoint calls behavior", () => {
      it("should return only new operations in subsequent calls", () => {
        storage.initialize();

        // First batch of operations
        const firstUpdates: OperationUpdate[] = [
          {
            Id: "first-batch-1",
            Type: OperationType.STEP,
            Action: OperationAction.START,
          },
          {
            Id: "first-batch-2",
            Type: OperationType.STEP,
            Action: OperationAction.START,
          },
        ];
        storage.registerUpdates(firstUpdates);

        // First checkpoint call
        const firstCheckpoint = storage.getDirtyOperations();
        expect(firstCheckpoint).toHaveLength(2);
        expect(firstCheckpoint.map((op) => op.Id)).toEqual([
          "first-batch-1",
          "first-batch-2",
        ]);

        // Second batch of operations
        const secondUpdates: OperationUpdate[] = [
          {
            Id: "second-batch-1",
            Type: OperationType.WAIT,
            Action: OperationAction.START,
            WaitOptions: { WaitSeconds: 5 },
          },
        ];
        storage.registerUpdates(secondUpdates);

        // Second checkpoint call should only return new operations
        const secondCheckpoint = storage.getDirtyOperations();
        expect(secondCheckpoint).toHaveLength(1);
        expect(secondCheckpoint[0].Id).toBe("second-batch-1");
      });

      it("should return empty array when no new operations since last checkpoint", () => {
        storage.initialize();

        const stepUpdate: OperationUpdate = {
          Id: "single-op",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        };
        storage.registerUpdate(stepUpdate);

        // First checkpoint call
        const firstCheckpoint = storage.getDirtyOperations();
        expect(firstCheckpoint).toHaveLength(1);

        // Second checkpoint call with no new operations
        const secondCheckpoint = storage.getDirtyOperations();
        expect(secondCheckpoint).toEqual([]);

        // Third checkpoint call should still be empty
        const thirdCheckpoint = storage.getDirtyOperations();
        expect(thirdCheckpoint).toEqual([]);
      });

      it("should handle mixed operation sources in sequential calls", () => {
        storage.initialize();

        // First: register operation
        storage.registerUpdate({
          Id: "registered-op",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        });

        const firstCheckpoint = storage.getDirtyOperations();
        expect(firstCheckpoint).toHaveLength(1);
        expect(firstCheckpoint[0].Id).toBe("registered-op");

        // Second: update existing operation
        storage.updateOperation(
          "registered-op",
          { Status: OperationStatus.SUCCEEDED },
          "final-result",
          undefined,
        );

        const secondCheckpoint = storage.getDirtyOperations();
        expect(secondCheckpoint).toHaveLength(1);
        expect(secondCheckpoint[0].Id).toBe("registered-op");
        expect(secondCheckpoint[0].Status).toBe(OperationStatus.SUCCEEDED);

        // Third: add new callback operation
        storage.registerUpdate({
          Id: "callback-op",
          Type: OperationType.CALLBACK,
          Action: OperationAction.START,
        });

        const thirdCheckpoint = storage.getDirtyOperations();
        expect(thirdCheckpoint).toHaveLength(1);
        expect(thirdCheckpoint[0].Id).toBe("callback-op");
      });
    });

    describe("edge cases and error handling", () => {
      it("should handle operations modified multiple times between checkpoints", () => {
        storage.initialize();

        // Register operation
        storage.registerUpdate({
          Id: "multi-modified",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        });

        // Update same operation multiple times
        storage.updateOperation(
          "multi-modified",
          { Status: OperationStatus.PENDING },
          undefined,
          undefined,
        );
        storage.updateOperation(
          "multi-modified",
          { Status: OperationStatus.SUCCEEDED },
          "result",
          undefined,
        );

        // Should only appear once in dirty operations
        const dirtyOperations = storage.getDirtyOperations();
        expect(dirtyOperations).toHaveLength(1);
        expect(dirtyOperations[0].Id).toBe("multi-modified");
        expect(dirtyOperations[0].Status).toBe(OperationStatus.SUCCEEDED);
      });

      it("should maintain dirty operations across getPendingCheckpointUpdates calls", async () => {
        storage.initialize();

        const stepUpdate: OperationUpdate = {
          Id: "pending-op",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        };
        storage.registerUpdate(stepUpdate);

        // getPendingCheckpointUpdates should not affect dirty operations
        const pendingUpdates = await storage.getPendingCheckpointUpdates();
        expect(pendingUpdates).toHaveLength(1);

        // getDirtyOperations should still return the operation
        const dirtyOperations = storage.getDirtyOperations();
        expect(dirtyOperations).toHaveLength(1);
        expect(dirtyOperations[0].Id).toBe("pending-op");
      });
    });
  });
});
