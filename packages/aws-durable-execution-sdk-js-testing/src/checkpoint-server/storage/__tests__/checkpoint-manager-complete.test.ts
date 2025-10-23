import {
  OperationAction,
  OperationType,
  OperationStatus,
} from "@aws-sdk/client-lambda";
import {
  createInvocationId,
  createExecutionId,
} from "../../utils/tagged-strings";
import { CheckpointManager } from "../checkpoint-manager";

jest.mock("node:crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("mocked-uuid"),
}));

describe("checkpoint-manager completeOperation", () => {
  let storage: CheckpointManager;

  const mockInvocationId = createInvocationId();

  beforeEach(() => {
    storage = new CheckpointManager(createExecutionId("test-execution-id"));
    jest.clearAllMocks();
  });

  afterEach(() => {
    storage.cleanup();
  });

  it("should update operation status and add sequence", () => {
    // Initialize with an operation
    const initialOperation = storage.initialize();

    // Complete the operation
    const { operation } = storage.completeOperation({
      Id: initialOperation.operation.Id,
      Action: OperationAction.SUCCEED,
      Type: OperationType.EXECUTION,
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
      mockInvocationId,
    );

    // Complete the operation
    const { operation } = storage.completeOperation({
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

  it("should not modify original operation object", () => {
    // Initialize with an operation
    const initialOperation = storage.initialize();

    // Complete the operation
    const { operation } = storage.completeOperation({
      Id: initialOperation.operation.Id,
      Action: OperationAction.SUCCEED,
      Type: OperationType.STEP,
    });

    // Check that the original operation object is not modified
    expect(initialOperation).not.toEqual(operation);
  });

  it("should throw error undefined for non-existent operation id", () => {
    expect(() =>
      storage.completeOperation({
        Id: "non-existent-id",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      }),
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
      mockInvocationId,
    );

    // Complete the operation
    const { operation } = storage.completeOperation({
      Id: "new-id",
      Action: OperationAction.SUCCEED,
      Payload: "new payload",
      Type: OperationType.STEP,
    });

    expect(operation).toBeDefined();
    expect(operation.Status).toBe(OperationStatus.SUCCEEDED);
    expect(operation.EndTimestamp).toBeInstanceOf(Date);
    expect(operation.ContextDetails?.ReplayChildren).toBe(true);
    expect(operation.ContextDetails?.Result).toEqual("new payload");
  });

  describe("retry operations", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2023-01-01T00:00:00.000Z"));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should process retry operation and set status to PENDING", () => {
      // Initialize storage
      storage.initialize();

      // Register a step operation
      storage.registerUpdate(
        {
          Id: "retry-step-id",
          Action: OperationAction.START,
          Type: OperationType.STEP,
          Name: "test-step",
        },
        mockInvocationId,
      );

      // Complete the operation with RETRY action
      const { operation } = storage.completeOperation({
        Id: "retry-step-id",
        Action: OperationAction.RETRY,
        Type: OperationType.STEP,
        Payload: "retry payload",
        Error: {
          ErrorType: "RetryableError",
          ErrorMessage: "Temporary failure",
        },
      });

      expect(operation).toBeDefined();
      expect(operation.Status).toBe(OperationStatus.PENDING);
      // RETRY operations don't get EndTimestamp because they remain PENDING
      expect(operation.EndTimestamp).toBeUndefined();
      expect(operation.StepDetails?.Result).toEqual("retry payload");
      expect(operation.StepDetails?.Error).toEqual({
        ErrorType: "RetryableError",
        ErrorMessage: "Temporary failure",
      });
      expect(operation.StepDetails?.Attempt).toBe(1);
      expect(operation.StepDetails?.NextAttemptTimestamp).toBeInstanceOf(Date);
    });

    it("should increment attempt number on retry", () => {
      // Initialize storage
      storage.initialize();

      // Register a step operation with initial attempt
      storage.registerUpdate(
        {
          Id: "retry-step-id",
          Action: OperationAction.START,
          Type: OperationType.STEP,
          Name: "test-step",
        },
        mockInvocationId,
      );

      // Set initial attempt to 2
      const operationData = storage.operationDataMap.get("retry-step-id");
      if (operationData) {
        operationData.operation.StepDetails = {
          ...operationData.operation.StepDetails,
          Attempt: 2,
        };
        storage.operationDataMap.set("retry-step-id", operationData);
      }

      // Complete the operation with RETRY action
      const { operation } = storage.completeOperation({
        Id: "retry-step-id",
        Action: OperationAction.RETRY,
        Type: OperationType.STEP,
      });

      expect(operation.StepDetails?.Attempt).toBe(3);
    });

    it("should preserve existing StepDetails when processing retry", () => {
      // Initialize storage
      storage.initialize();

      // Register a step operation
      storage.registerUpdate(
        {
          Id: "retry-step-id",
          Action: OperationAction.START,
          Type: OperationType.STEP,
          Name: "test-step",
        },
        mockInvocationId,
      );

      // Add some existing step details
      const operationData = storage.operationDataMap.get("retry-step-id");
      if (operationData) {
        operationData.operation.StepDetails = {
          ...operationData.operation.StepDetails,
          Result: "previous result",
          Error: {
            ErrorType: "PreviousError",
            ErrorMessage: "Previous error message",
          },
        };
        storage.operationDataMap.set("retry-step-id", operationData);
      }

      // Complete the operation with RETRY action and a new error
      const { operation } = storage.completeOperation({
        Id: "retry-step-id",
        Action: OperationAction.RETRY,
        Type: OperationType.STEP,
        Payload: "new result",
        Error: {
          ErrorType: "RetryError",
          ErrorMessage: "New retry error",
        },
      });

      expect(operation.Status).toBe(OperationStatus.PENDING);
      expect(operation.StepDetails?.Result).toBe("new result");
      expect(operation.StepDetails?.Attempt).toBe(1);
      expect(operation.StepDetails?.NextAttemptTimestamp).toBeInstanceOf(Date);
      // Error should be updated with the new error from the retry
      expect(operation.StepDetails?.Error).toEqual({
        ErrorType: "RetryError",
        ErrorMessage: "New retry error",
      });
    });

    it("should handle retry on operation with no existing StepDetails", () => {
      // Initialize storage
      storage.initialize();

      // Register a step operation
      storage.registerUpdate(
        {
          Id: "retry-step-id",
          Action: OperationAction.START,
          Type: OperationType.STEP,
          Name: "test-step",
        },
        mockInvocationId,
      );

      // Ensure no existing StepDetails
      const operationData = storage.operationDataMap.get("retry-step-id");
      if (operationData) {
        operationData.operation.StepDetails = undefined;
        storage.operationDataMap.set("retry-step-id", operationData);
      }

      // Complete the operation with RETRY action
      const { operation } = storage.completeOperation({
        Id: "retry-step-id",
        Action: OperationAction.RETRY,
        Type: OperationType.STEP,
      });

      expect(operation.Status).toBe(OperationStatus.PENDING);
      expect(operation.StepDetails?.Attempt).toBe(1);
      expect(operation.StepDetails?.NextAttemptTimestamp).toBeInstanceOf(Date);
    });
  });
});
