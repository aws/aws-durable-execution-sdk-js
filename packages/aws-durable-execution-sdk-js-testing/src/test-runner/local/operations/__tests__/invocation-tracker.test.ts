import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { InvocationTracker } from "../invocation-tracker";
import { LocalOperationStorage } from "../local-operation-storage";
import { createInvocationId } from "../../../../checkpoint-server/utils/tagged-strings";
import { OperationWaitManager } from "../operation-wait-manager";
import { IndexedOperations } from "../../../common/indexed-operations";
import { MockOperation } from "../mock-operation";
import { OperationEvents } from "../../../common/operations/operation-with-data";

describe("InvocationTracker", () => {
  let waitManager: OperationWaitManager;
  let indexedOperations: IndexedOperations;
  let operationStorage: LocalOperationStorage;
  let invocationTracker: InvocationTracker;

  // Helper function to create test operations
  const createMockOperation = (
    id: string,
    status: OperationStatus = OperationStatus.SUCCEEDED
  ): MockOperation => {
    const operation = new MockOperation({ id }, waitManager, indexedOperations);
    const checkpointOp: OperationEvents = {
      operation: {
        Id: id,
        Status: status,
        Type: OperationType.STEP,
        Name: `operation-${id}`,
      },
      events: [],
    };
    operation.populateData(checkpointOp);
    return operation;
  };

  beforeEach(() => {
    waitManager = new OperationWaitManager();
    indexedOperations = new IndexedOperations([]);
    operationStorage = new LocalOperationStorage(
      waitManager,
      indexedOperations,
      jest.fn()
    );
    invocationTracker = new InvocationTracker(operationStorage);
  });

  describe("constructor", () => {
    it("should initialize with an empty invocations array", () => {
      expect(invocationTracker.getInvocations()).toEqual([]);
    });
  });

  describe("reset", () => {
    it("should clear all invocations and operation mappings", () => {
      // Setup: Add some invocations and operations
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");
      invocationTracker.createInvocation(invocationId1);
      invocationTracker.createInvocation(invocationId2);
      invocationTracker.associateOperation([invocationId1], "op1");
      invocationTracker.associateOperation([invocationId2], "op2");

      // Verify setup worked
      expect(invocationTracker.getInvocations().length).toBe(2);

      // Act: Reset the tracker
      invocationTracker.reset();

      // Assert: All data should be cleared
      expect(invocationTracker.getInvocations()).toEqual([]);

      // Set up operations in storage
      const op1 = createMockOperation("op1");
      const op2 = createMockOperation("op2");
      jest
        .spyOn(operationStorage, "getOperations")
        .mockReturnValue([op1, op2]);

      // Verify that operation mappings are cleared
      const ops = invocationTracker.getOperationsForInvocation(invocationId1);
      expect(ops).toEqual([]);
    });
  });

  describe("createInvocation", () => {
    it("should create and return an invocation object with the given ID", () => {
      const invocationId = createInvocationId("test-invocation");

      const invocation = invocationTracker.createInvocation(invocationId);

      expect(invocation.id).toBe(invocationId);
      expect(typeof invocation.getOperations).toBe("function");
    });

    it("should add the created invocation to the invocations list", () => {
      const invocationId = createInvocationId("test-invocation");

      invocationTracker.createInvocation(invocationId);

      const invocations = invocationTracker.getInvocations();
      expect(invocations.length).toBe(1);
      expect(invocations[0].id).toBe(invocationId);
    });

    it("should create unique invocation objects for different IDs", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");

      const invocation1 = invocationTracker.createInvocation(invocationId1);
      const invocation2 = invocationTracker.createInvocation(invocationId2);

      expect(invocation1.id).toBe(invocationId1);
      expect(invocation2.id).toBe(invocationId2);
      expect(invocation1).not.toBe(invocation2);

      const invocations = invocationTracker.getInvocations();
      expect(invocations.length).toBe(2);
      expect(invocations[0].id).toBe(invocationId1);
      expect(invocations[1].id).toBe(invocationId2);
    });
  });

  describe("associateOperation", () => {
    it("should associate an operation with a single invocation", () => {
      const invocationId = createInvocationId("test-invocation");
      const operationId = "test-operation";

      // Setup an operation in storage
      const mockOperation = createMockOperation(operationId);
      jest
        .spyOn(operationStorage, "getOperations")
        .mockReturnValue([mockOperation]);

      // Associate the operation with the invocation
      invocationTracker.associateOperation([invocationId], operationId);

      // Get operations for the invocation
      const operations =
        invocationTracker.getOperationsForInvocation(invocationId);

      // Verify the operation is associated
      expect(operations.length).toBe(1);
      expect(operations[0].getId()).toBe(operationId);
    });

    it("should associate an operation with multiple invocations", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");
      const operationId = "shared-operation";

      // Setup an operation in storage
      const mockOperation = createMockOperation(operationId);
      jest
        .spyOn(operationStorage, "getOperations")
        .mockReturnValue([mockOperation]);

      // Associate the operation with both invocations
      invocationTracker.associateOperation(
        [invocationId1, invocationId2],
        operationId
      );

      // Get operations for each invocation
      const operations1 =
        invocationTracker.getOperationsForInvocation(invocationId1);
      const operations2 =
        invocationTracker.getOperationsForInvocation(invocationId2);

      // Verify the operation is associated with both invocations
      expect(operations1.length).toBe(1);
      expect(operations1[0].getId()).toBe(operationId);

      expect(operations2.length).toBe(1);
      expect(operations2[0].getId()).toBe(operationId);
    });

    it("should handle associating multiple operations with the same invocation", () => {
      const invocationId = createInvocationId("test-invocation");
      const operationId1 = "operation-1";
      const operationId2 = "operation-2";

      // Setup operations in storage
      const mockOperation1 = createMockOperation(operationId1);
      const mockOperation2 = createMockOperation(operationId2);
      jest
        .spyOn(operationStorage, "getOperations")
        .mockReturnValue([mockOperation1, mockOperation2]);

      // Associate both operations with the invocation
      invocationTracker.associateOperation([invocationId], operationId1);
      invocationTracker.associateOperation([invocationId], operationId2);

      // Get operations for the invocation
      const operations =
        invocationTracker.getOperationsForInvocation(invocationId);

      // Verify both operations are associated
      expect(operations.length).toBe(2);
      const operationIds = operations.map((op) => op.getId());
      expect(operationIds).toContain(operationId1);
      expect(operationIds).toContain(operationId2);
    });

    it("should not add duplicate operation associations", () => {
      const invocationId = createInvocationId("test-invocation");
      const operationId = "test-operation";

      // Setup an operation in storage
      const mockOperation = createMockOperation(operationId);
      jest
        .spyOn(operationStorage, "getOperations")
        .mockReturnValue([mockOperation]);

      // Associate the same operation twice
      invocationTracker.associateOperation([invocationId], operationId);
      invocationTracker.associateOperation([invocationId], operationId);

      // Get operations for the invocation
      const operations =
        invocationTracker.getOperationsForInvocation(invocationId);

      // Verify the operation is only associated once
      expect(operations.length).toBe(1);
      expect(operations[0].getId()).toBe(operationId);
    });
  });

  describe("getOperationsForInvocation", () => {
    let invocationId1: ReturnType<typeof createInvocationId>;
    let invocationId2: ReturnType<typeof createInvocationId>;

    beforeEach(() => {
      invocationId1 = createInvocationId("test-invocation-1");
      invocationId2 = createInvocationId("test-invocation-2");

      // Create mock operations with different statuses
      const op1 = createMockOperation("op1", OperationStatus.SUCCEEDED);
      const op2 = createMockOperation("op2", OperationStatus.FAILED);
      const op3 = createMockOperation("op3", OperationStatus.SUCCEEDED);

      jest
        .spyOn(operationStorage, "getOperations")
        .mockReturnValue([op1, op2, op3]);

      // Associate operations with invocations
      invocationTracker.associateOperation([invocationId1], "op1");
      invocationTracker.associateOperation([invocationId1], "op2");
      invocationTracker.associateOperation([invocationId2], "op2");
      invocationTracker.associateOperation([invocationId2], "op3");
    });

    it("should return all operations for an invocation when no status filter is provided", () => {
      const operations =
        invocationTracker.getOperationsForInvocation(invocationId1);

      expect(operations.length).toBe(2);
      const operationIds = operations.map((op) => op.getId());
      expect(operationIds).toContain("op1");
      expect(operationIds).toContain("op2");
    });

    it("should filter operations by status when a status filter is provided", () => {
      const succeededOps = invocationTracker.getOperationsForInvocation(
        invocationId1,
        OperationStatus.SUCCEEDED
      );
      const failedOps = invocationTracker.getOperationsForInvocation(
        invocationId1,
        OperationStatus.FAILED
      );

      expect(succeededOps.length).toBe(1);
      expect(succeededOps[0].getId()).toBe("op1");

      expect(failedOps.length).toBe(1);
      expect(failedOps[0].getId()).toBe("op2");
    });

    it("should return different operations for different invocations", () => {
      const ops1 = invocationTracker.getOperationsForInvocation(invocationId1);
      const ops2 = invocationTracker.getOperationsForInvocation(invocationId2);

      expect(ops1.length).toBe(2);
      const opIds1 = ops1.map((op) => op.getId()).sort();
      expect(opIds1).toEqual(["op1", "op2"]);

      expect(ops2.length).toBe(2);
      const opIds2 = ops2.map((op) => op.getId()).sort();
      expect(opIds2).toEqual(["op2", "op3"]);
    });

    it("should handle operations appearing in multiple invocations", () => {
      // op2 is associated with both invocations
      const ops1 = invocationTracker.getOperationsForInvocation(invocationId1);
      const ops2 = invocationTracker.getOperationsForInvocation(invocationId2);

      // Check if ops contain operation with ID "op2"
      const opsContainOp2 = (
        ops: ReturnType<typeof invocationTracker.getOperationsForInvocation>
      ) => ops.some((op) => op.getId() === "op2");

      expect(opsContainOp2(ops1)).toBe(true);
      expect(opsContainOp2(ops2)).toBe(true);
    });

    it("should return an empty array when no operations are associated with an invocation", () => {
      const unknownInvocationId = createInvocationId("unknown");
      const operations =
        invocationTracker.getOperationsForInvocation(unknownInvocationId);

      expect(operations).toEqual([]);
    });

    it("should handle the case when an operation ID is missing", () => {
      // Create a mock operation without an ID
      const mockOpWithoutId = createMockOperation("missing-id");
      // Override the getId method to return undefined
      jest.spyOn(mockOpWithoutId, "getId").mockReturnValue(undefined);

      const allOps = operationStorage.getOperations();
      jest
        .spyOn(operationStorage, "getOperations")
        .mockReturnValue([...allOps, mockOpWithoutId]);

      // Even with the invalid operation, we should still get our valid ones
      const operations =
        invocationTracker.getOperationsForInvocation(invocationId1);

      expect(operations.length).toBe(2); // Still only the valid operations
      const operationIds = operations.map((op) => op.getId());
      expect(operationIds).toContain("op1");
      expect(operationIds).toContain("op2");
    });
  });

  describe("invocation.getOperations", () => {
    it("should return operations when called without status filter", () => {
      const invocationId = createInvocationId("test-invocation");
      const operationId = "test-operation";

      // Setup an operation in storage
      const mockOperation = createMockOperation(operationId);
      jest
        .spyOn(operationStorage, "getOperations")
        .mockReturnValue([mockOperation]);

      // Associate operation with invocation
      invocationTracker.associateOperation([invocationId], operationId);

      // Get invocation
      const invocation = invocationTracker.createInvocation(invocationId);

      // Call getOperations without a status filter
      const operations = invocation.getOperations();

      expect(operations.length).toBe(1);
      expect(operations[0].getId()).toBe(operationId);
    });

    it("should apply status filter when provided", () => {
      const invocationId = createInvocationId("test-invocation");

      // Setup operations with different statuses
      const successOp = createMockOperation("op1", OperationStatus.SUCCEEDED);
      const failedOp = createMockOperation("op2", OperationStatus.FAILED);
      jest
        .spyOn(operationStorage, "getOperations")
        .mockReturnValue([successOp, failedOp]);

      // Associate operations with invocation
      invocationTracker.associateOperation([invocationId], "op1");
      invocationTracker.associateOperation([invocationId], "op2");

      // Get invocation
      const invocation = invocationTracker.createInvocation(invocationId);

      // Call getOperations with a status filter
      const succeededOps = invocation.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      const failedOps = invocation.getOperations({
        status: OperationStatus.FAILED,
      });

      expect(succeededOps.length).toBe(1);
      expect(succeededOps[0].getId()).toBe("op1");

      expect(failedOps.length).toBe(1);
      expect(failedOps[0].getId()).toBe("op2");
    });
  });

  describe("getInvocations", () => {
    it("should return all created invocations", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");

      invocationTracker.createInvocation(invocationId1);
      invocationTracker.createInvocation(invocationId2);

      const invocations = invocationTracker.getInvocations();

      expect(invocations.length).toBe(2);
      expect(invocations[0].id).toBe(invocationId1);
      expect(invocations[1].id).toBe(invocationId2);
    });

    it("should return a copy of the invocations array", () => {
      const invocationId = createInvocationId("test-invocation");
      invocationTracker.createInvocation(invocationId);

      const invocations1 = invocationTracker.getInvocations();
      expect(invocations1.length).toBe(1);

      // Modifying the returned array should not affect the internal state
      invocations1.pop();

      const invocations2 = invocationTracker.getInvocations();
      expect(invocations2.length).toBe(1); // Should still have the invocation
    });

    it("should return an empty array when no invocations exist", () => {
      const invocations = invocationTracker.getInvocations();
      expect(invocations).toEqual([]);
    });
  });

  describe("hasActiveInvocation", () => {
    it("should return false when no invocations exist", () => {
      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });

    it("should return true when invocations exist but none are completed", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");

      invocationTracker.createInvocation(invocationId1);
      invocationTracker.createInvocation(invocationId2);

      expect(invocationTracker.hasActiveInvocation()).toBe(true);
    });

    it("should return false when all invocations are completed", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");

      invocationTracker.createInvocation(invocationId1);
      invocationTracker.createInvocation(invocationId2);

      // Complete both invocations
      invocationTracker.completeInvocation(invocationId1);
      invocationTracker.completeInvocation(invocationId2);

      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });

    it("should return true when some but not all invocations are completed", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");
      const invocationId3 = createInvocationId("test-invocation-3");

      invocationTracker.createInvocation(invocationId1);
      invocationTracker.createInvocation(invocationId2);
      invocationTracker.createInvocation(invocationId3);

      // Complete only first two invocations
      invocationTracker.completeInvocation(invocationId1);
      invocationTracker.completeInvocation(invocationId2);

      expect(invocationTracker.hasActiveInvocation()).toBe(true);
    });

    it("should handle single invocation lifecycle correctly", () => {
      const invocationId = createInvocationId("test-invocation");

      // No invocations - should be false
      expect(invocationTracker.hasActiveInvocation()).toBe(false);

      // Create invocation - should be true (active)
      invocationTracker.createInvocation(invocationId);
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Complete invocation - should be false (no active)
      invocationTracker.completeInvocation(invocationId);
      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });
  });

  describe("completeInvocation", () => {
    it("should mark a single invocation as completed", () => {
      const invocationId = createInvocationId("test-invocation");

      invocationTracker.createInvocation(invocationId);
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      invocationTracker.completeInvocation(invocationId);
      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });

    it("should handle completing multiple invocations", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");
      const invocationId3 = createInvocationId("test-invocation-3");

      invocationTracker.createInvocation(invocationId1);
      invocationTracker.createInvocation(invocationId2);
      invocationTracker.createInvocation(invocationId3);

      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Complete them one by one and verify state
      invocationTracker.completeInvocation(invocationId1);
      expect(invocationTracker.hasActiveInvocation()).toBe(true); // Still 2 active

      invocationTracker.completeInvocation(invocationId2);
      expect(invocationTracker.hasActiveInvocation()).toBe(true); // Still 1 active

      invocationTracker.completeInvocation(invocationId3);
      expect(invocationTracker.hasActiveInvocation()).toBe(false); // All completed
    });

    it("should handle completing the same invocation multiple times", () => {
      const invocationId = createInvocationId("test-invocation");

      invocationTracker.createInvocation(invocationId);
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Complete the same invocation multiple times
      invocationTracker.completeInvocation(invocationId);
      invocationTracker.completeInvocation(invocationId);
      invocationTracker.completeInvocation(invocationId);

      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });

    it("should handle completing non-existent invocations gracefully", () => {
      const nonExistentId = createInvocationId("non-existent");
      const existingId = createInvocationId("existing");

      invocationTracker.createInvocation(existingId);
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Try to complete a non-existent invocation
      invocationTracker.completeInvocation(nonExistentId);

      // Existing invocation should still be active
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Complete the existing one
      invocationTracker.completeInvocation(existingId);
      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });
  });

  describe("reset with new completion tracking", () => {
    it("should clear completion tracking when reset", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");

      invocationTracker.createInvocation(invocationId1);
      invocationTracker.createInvocation(invocationId2);
      invocationTracker.completeInvocation(invocationId1);

      expect(invocationTracker.hasActiveInvocation()).toBe(true); // One still active

      // Reset should clear everything
      invocationTracker.reset();

      expect(invocationTracker.hasActiveInvocation()).toBe(false); // No invocations
      expect(invocationTracker.getInvocations()).toEqual([]);

      // After reset, creating new invocations should work normally
      const newInvocationId = createInvocationId("new-invocation");
      invocationTracker.createInvocation(newInvocationId);
      expect(invocationTracker.hasActiveInvocation()).toBe(true);
    });
  });
});
