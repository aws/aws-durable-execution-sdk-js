import {
  OperationUpdate,
  OperationType,
  OperationAction,
  OperationStatus,
} from "@aws-sdk/client-lambda";
import { createExecutionId } from "../../utils/tagged-strings";
import { CheckpointManager } from "../checkpoint-manager";

jest.mock("node:crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("mocked-uuid"),
}));

describe("checkpoint-manager registerUpdate", () => {
  let storage: CheckpointManager;

  beforeEach(() => {
    storage = new CheckpointManager(createExecutionId("test-execution-id"));
    jest.clearAllMocks();
  });

  afterEach(() => {
    storage.cleanup();
  });

  it("should throw error if id is missing", () => {
    const updateWithoutId: Partial<OperationUpdate> = {
      Type: OperationType.STEP,
      Action: OperationAction.START,
    };

    expect(() =>
      storage.registerUpdate(updateWithoutId as OperationUpdate),
    ).toThrow("Missing Id in update");
  });

  it("should create and register a new STEP operation", () => {
    const update: OperationUpdate = {
      Id: "step-id",
      Action: OperationAction.START,
      Name: "test-step",
      Type: OperationType.STEP,
    };

    const result = storage.registerUpdate(update);

    expect(result).toBeDefined();
    expect(result.operation.Id).toBe("step-id");
    expect(result.operation.Name).toBe("test-step");
    expect(result.operation.Type).toBe(OperationType.STEP);
    expect(result.operation.Status).toBe(OperationStatus.STARTED);
    expect(result.operation.StartTimestamp).toBeInstanceOf(Date);
    expect(result.operation.StepDetails).toBeUndefined();

    expect(storage.getOperationData("step-id")).toStrictEqual(result);
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

    const result = storage.registerUpdate(update);

    expect(result).toBeDefined();
    expect(result.operation.Id).toBe("CONTEXT-id");
    expect(result.operation.Name).toBe("test-step");
    expect(result.operation.Type).toBe(OperationType.CONTEXT);
    expect(result.operation.Status).toBe(OperationStatus.STARTED);
    expect(result.operation.StartTimestamp).toBeInstanceOf(Date);
    expect(result.operation.StepDetails).toBeUndefined();
    expect(result.operation.ContextDetails?.ReplayChildren).toBe(true);

    expect(storage.getOperationData("CONTEXT-id")).toStrictEqual(result);
  });

  it("should update operation with new step details", () => {
    // Initialize storage
    storage.initialize();

    // Register a step operation
    storage.registerUpdate({
      Id: "new-id",
      Action: OperationAction.START,
      Type: OperationType.STEP,
    });

    // Register the operation
    const { operation } = storage.registerUpdate({
      Id: "new-id",
      Action: OperationAction.SUCCEED,
      Payload: "new payload",
      Type: OperationType.STEP,
    });

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

    const result = storage.registerUpdate(update);

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

    const result = storage.registerUpdate(update);

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

    const result = storage.registerUpdate(update);

    expect(result).toBeDefined();
    expect(result.operation.Id).toBe("wait-id");
    expect(result.operation.Type).toBe(OperationType.WAIT);
    expect(result.operation.WaitDetails?.ScheduledEndTimestamp).toBeInstanceOf(
      Date,
    );

    // Make sure waitDetails exists and has a scheduledEndTimestamp
    expect(result.operation.WaitDetails).toBeDefined();
    expect(result.operation.WaitDetails?.ScheduledEndTimestamp).toBeDefined();

    // Since we've already verified the timestamp exists and is a Date (earlier in this test),
    // we can now verify it's approximately 5 seconds in the future

    // Create a reference time just before we call the function to compare against
    const now = new Date().getTime();

    const timestamp = result.operation.WaitDetails?.ScheduledEndTimestamp;
    expect(timestamp).toBeInstanceOf(Date);

    const scheduledTime = timestamp instanceof Date ? timestamp.getTime() : 0;

    // Allow 1 second tolerance for test execution time
    expect(scheduledTime).toBeGreaterThan(now + 4000);
    expect(scheduledTime).toBeLessThan(now + 6000);
  });

  it("should return existing operation if it has waitDetails with scheduledEndTimestamp", () => {
    // First register a wait operation
    const waitUpdate: OperationUpdate = {
      Id: "wait-id",
      Type: OperationType.WAIT,
      Action: OperationAction.START,
      WaitOptions: {
        WaitSeconds: 5,
      },
    };
    const firstResult = storage.registerUpdate(waitUpdate);

    // Try to register it again
    const secondResult = storage.registerUpdate(waitUpdate);

    expect(secondResult).toStrictEqual(firstResult);
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
    storage.registerUpdate(update);

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

      const result = storage.registerUpdate(update);

      expect(result).toBeDefined();
      expect(result.operation.Id).toBe("step-id");
      expect(result.operation.Name).toBe("test-step");
      expect(result.operation.Type).toBe(OperationType.STEP);
      expect(result.operation.Status).toBe(
        action === OperationAction.SUCCEED
          ? OperationStatus.SUCCEEDED
          : OperationStatus.FAILED,
      );
      expect(result.operation.StartTimestamp).toBeInstanceOf(Date);
      expect(result.operation.StepDetails).toEqual({
        Attempt: 1,
      });
      expect(result.operation.EndTimestamp).toBeInstanceOf(Date);

      expect(storage.getOperationData("step-id")).toStrictEqual(result);
    },
  );

  describe("retry operations", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2023-01-01T00:00:00.000Z"));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should process retry operation during initial registration", () => {
      // Register a STEP operation with RETRY action
      const result = storage.registerUpdate({
        Id: "retry-step-id",
        Action: OperationAction.RETRY,
        Type: OperationType.STEP,
        Name: "test-retry-step",
        StepOptions: {
          NextAttemptDelaySeconds: 15,
        },
      });

      expect(result.operation.Id).toBe("retry-step-id");
      expect(result.operation.Status).toBe(OperationStatus.PENDING);
      expect(result.operation.Type).toBe(OperationType.STEP);
      expect(result.operation.Name).toBe("test-retry-step");
      expect(result.operation.StartTimestamp).toBeInstanceOf(Date);
      expect(result.operation.StepDetails?.Attempt).toBe(1);
      expect(result.operation.StepDetails?.NextAttemptTimestamp).toBeInstanceOf(
        Date,
      );

      // Check that NextAttemptTimestamp is set correctly (current time + 15 seconds)
      const expectedTimestamp = new Date("2023-01-01T00:00:15.000Z");
      expect(result.operation.StepDetails?.NextAttemptTimestamp).toEqual(
        expectedTimestamp,
      );

      // Verify operation is stored correctly
      expect(storage.getOperationData("retry-step-id")).toStrictEqual(result);
    });

    it("should not process retry for START action during registration", () => {
      const result = storage.registerUpdate({
        Id: "step-start-id",
        Action: OperationAction.START,
        Type: OperationType.STEP,
        Name: "test-step-start",
      });

      expect(result.operation.Status).toBe(OperationStatus.STARTED);
      expect(result.operation.StepDetails?.Attempt).toBeUndefined();
      expect(
        result.operation.StepDetails?.NextAttemptTimestamp,
      ).toBeUndefined();
    });

    it("should handle multiple retry operations with different delays", () => {
      // Register first retry operation
      const retry1 = storage.registerUpdate({
        Id: "retry-1-id",
        Action: OperationAction.RETRY,
        Type: OperationType.STEP,
        Name: "test-retry-1",
        StepOptions: {
          NextAttemptDelaySeconds: 10,
        },
      });

      // Register second retry operation
      const retry2 = storage.registerUpdate({
        Id: "retry-2-id",
        Action: OperationAction.RETRY,
        Type: OperationType.STEP,
        Name: "test-retry-2",
        StepOptions: {
          NextAttemptDelaySeconds: 20,
        },
      });

      expect(retry1.operation.Status).toBe(OperationStatus.PENDING);
      expect(retry1.operation.StepDetails?.Attempt).toBe(1);
      expect(retry1.operation.StepDetails?.NextAttemptTimestamp).toEqual(
        new Date("2023-01-01T00:00:10.000Z"),
      );

      expect(retry2.operation.Status).toBe(OperationStatus.PENDING);
      expect(retry2.operation.StepDetails?.Attempt).toBe(1);
      expect(retry2.operation.StepDetails?.NextAttemptTimestamp).toEqual(
        new Date("2023-01-01T00:00:20.000Z"),
      );
    });

    it("should preserve other operation properties when processing retry", () => {
      const result = storage.registerUpdate({
        Id: "retry-with-props-id",
        Action: OperationAction.RETRY,
        Type: OperationType.STEP,
        Name: "test-retry-with-props",
        ParentId: "parent-operation-id",
        SubType: "custom-subtype",
        StepOptions: {
          NextAttemptDelaySeconds: 30,
        },
      });

      expect(result.operation.Status).toBe(OperationStatus.PENDING);
      expect(result.operation.Name).toBe("test-retry-with-props");
      expect(result.operation.ParentId).toBe("parent-operation-id");
      expect(result.operation.SubType).toBe("custom-subtype");
      expect(result.operation.StepDetails?.Attempt).toBe(1);
      expect(result.operation.StepDetails?.NextAttemptTimestamp).toEqual(
        new Date("2023-01-01T00:00:30.000Z"),
      );
    });
  });

  describe("isExecutionCompleted", () => {
    it("should return false when checkpoint manager is first created", () => {
      expect(storage.isExecutionCompleted()).toBe(false);
    });

    it("should return false after registering non-execution operations", () => {
      // Register various operation types
      storage.registerUpdate({
        Id: "step-id",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      });

      storage.registerUpdate({
        Id: "wait-id",
        Type: OperationType.WAIT,
        Action: OperationAction.START,
        WaitOptions: { WaitSeconds: 5 },
      });

      storage.registerUpdate({
        Id: "context-id",
        Type: OperationType.CONTEXT,
        Action: OperationAction.START,
      });

      expect(storage.isExecutionCompleted()).toBe(false);
    });

    it.each([
      OperationStatus.SUCCEEDED,
      OperationStatus.FAILED,
      OperationStatus.TIMED_OUT,
    ])(
      "should return true after updating execution operation to %s status",
      (status) => {
        // Initialize and get the execution operation
        const initialOperation = storage.initialize();
        const executionId = initialOperation.operation.Id;

        expect(storage.isExecutionCompleted()).toBe(false);

        // Update the execution operation to SUCCEEDED
        storage.updateOperation(
          executionId,
          { Status: status },
          "execution result",
          { ErrorType: "ExecutionError", ErrorMessage: "execution error" },
        );

        expect(storage.isExecutionCompleted()).toBe(true);
      },
    );

    it("should remain true once execution is completed", () => {
      // Initialize and complete execution
      const initialOperation = storage.initialize();
      const executionId = initialOperation.operation.Id;

      storage.updateOperation(
        executionId,
        { Status: OperationStatus.SUCCEEDED },
        "execution result",
        undefined,
      );

      expect(storage.isExecutionCompleted()).toBe(true);

      // Try registering more operations - completion state should remain true
      storage.registerUpdate({
        Id: "step-after-completion",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      });

      expect(storage.isExecutionCompleted()).toBe(true);
    });

    it("should not process updates when execution is completed", () => {
      // Initialize and complete execution
      const initialOperation = storage.initialize();
      const executionId = initialOperation.operation.Id;

      storage.updateOperation(
        executionId,
        { Status: OperationStatus.SUCCEEDED },
        "execution result",
        undefined,
      );

      expect(storage.isExecutionCompleted()).toBe(true);

      // Try to register updates - should return empty array
      const updates = [
        {
          Id: "step-1",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        },
        {
          Id: "step-2",
          Type: OperationType.STEP,
          Action: OperationAction.START,
        },
      ] as OperationUpdate[];

      expect(() => storage.registerUpdates(updates)).toThrow(
        "Invalid checkpoint token",
      );
      expect(storage.getOperationData("step-1")).toBeUndefined();
      expect(storage.getOperationData("step-2")).toBeUndefined();
    });

    it("should not affect execution completion when updating non-execution operations", () => {
      // Initialize storage and add some operations
      storage.initialize();

      storage.registerUpdate({
        Id: "step-id",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      });

      expect(storage.isExecutionCompleted()).toBe(false);

      // Update the step operation to completed
      storage.updateOperation(
        "step-id",
        { Status: OperationStatus.SUCCEEDED },
        "step result",
        undefined,
      );

      // Execution should still not be completed since we only updated a STEP operation
      expect(storage.isExecutionCompleted()).toBe(false);
    });
  });
});
