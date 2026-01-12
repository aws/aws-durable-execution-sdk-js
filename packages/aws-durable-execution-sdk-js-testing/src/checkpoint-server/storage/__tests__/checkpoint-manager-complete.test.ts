import {
  OperationAction,
  OperationType,
  OperationStatus,
} from "@aws-sdk/client-lambda";
import { createExecutionId } from "../../utils/tagged-strings";
import { CheckpointManager } from "../checkpoint-manager";

jest.mock("node:crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("mocked-uuid"),
}));

describe("checkpoint-manager completeOperation", () => {
  let storage: CheckpointManager;

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
    storage.registerUpdate({
      Id: "new-id",
      Action: OperationAction.START,
      Type: OperationType.STEP,
    });

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
    storage.registerUpdate({
      Id: "new-id",
      Action: OperationAction.START,
      Type: OperationType.CONTEXT,
      ContextOptions: {
        ReplayChildren: true,
      },
    });

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
      storage.registerUpdate({
        Id: "retry-step-id",
        Action: OperationAction.START,
        Type: OperationType.STEP,
        Name: "test-step",
      });

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
      storage.registerUpdate({
        Id: "retry-step-id",
        Action: OperationAction.RETRY,
        Type: OperationType.STEP,
        Name: "test-step",
      });

      // Second attempt
      storage.registerUpdate({
        Id: "retry-step-id",
        Action: OperationAction.RETRY,
        Type: OperationType.STEP,
        Name: "test-step",
      });

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
      storage.registerUpdate({
        Id: "retry-step-id",
        Action: OperationAction.START,
        Type: OperationType.STEP,
        Name: "test-step",
        Payload: "previous result",
        Error: {
          ErrorType: "PreviousError",
          ErrorMessage: "Previous error message",
        },
      });

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
  });

  describe("markOperationCompleted with STEP operation type", () => {
    it("should initialize Attempt to 1 when StepDetails is undefined", () => {
      const stepOperation = {
        Id: "step-3",
        Type: OperationType.STEP,
        Status: OperationStatus.STARTED,
        StartTimestamp: new Date(),
      };

      const result = storage.markOperationCompleted(
        stepOperation,
        OperationStatus.SUCCEEDED,
      );

      expect(result.Status).toBe(OperationStatus.SUCCEEDED);
      expect(result.EndTimestamp).toBeInstanceOf(Date);
      expect(result.StepDetails?.Attempt).toBe(1);
    });

    it("should not modify the original operation object", () => {
      const stepOperation = {
        Id: "step-5",
        Type: OperationType.STEP,
        Status: OperationStatus.STARTED,
        StartTimestamp: new Date(),
        StepDetails: {
          Attempt: 1,
        },
      };

      const originalAttempt = stepOperation.StepDetails.Attempt;
      const originalStatus = stepOperation.Status;

      const result = storage.markOperationCompleted(
        stepOperation,
        OperationStatus.SUCCEEDED,
      );

      // Original object should not be modified
      expect(stepOperation.Status).toBe(originalStatus);
      expect(stepOperation.StepDetails.Attempt).toBe(originalAttempt);
      expect("EndTimestamp" in stepOperation).toBe(false);

      // Result should be different
      expect(result).not.toBe(stepOperation);
      expect(result.Status).toBe(OperationStatus.SUCCEEDED);
      expect(result.StepDetails?.Attempt).toBe(2);
      expect(result.EndTimestamp).toBeInstanceOf(Date);
    });

    it("should preserve all StepDetails properties while incrementing attempt", () => {
      const stepOperation = {
        Id: "step-6",
        Type: OperationType.STEP,
        Status: OperationStatus.STARTED,
        StartTimestamp: new Date(),
        StepDetails: {
          Attempt: 3,
          Result: "test result",
          Error: {
            ErrorType: "SomeError",
            ErrorMessage: "Error occurred",
          },
          NextAttemptTimestamp: new Date("2023-01-01T01:00:00.000Z"),
        },
      };

      const result = storage.markOperationCompleted(
        stepOperation,
        OperationStatus.SUCCEEDED,
      );

      expect(result.Status).toBe(OperationStatus.SUCCEEDED);
      expect(result.EndTimestamp).toBeInstanceOf(Date);
      expect(result.StepDetails?.Attempt).toBe(4);
      expect(result.StepDetails?.Result).toBe("test result");
      expect(result.StepDetails?.Error).toEqual({
        ErrorType: "SomeError",
        ErrorMessage: "Error occurred",
      });
      expect(result.StepDetails?.NextAttemptTimestamp).toEqual(
        new Date("2023-01-01T01:00:00.000Z"),
      );
    });

    it("should preserve operation properties other than Status and EndTimestamp", () => {
      const stepOperation = {
        Id: "step-8",
        Name: "TestStep",
        Type: OperationType.STEP,
        SubType: "CustomSubType",
        Status: OperationStatus.STARTED,
        StartTimestamp: new Date("2023-01-01T00:00:00.000Z"),
        ParentId: "parent-id",
        StepDetails: {
          Attempt: 1,
        },
      };

      const result = storage.markOperationCompleted(
        stepOperation,
        OperationStatus.SUCCEEDED,
      );

      expect(result.Id).toBe("step-8");
      expect(result.Name).toBe("TestStep");
      expect(result.Type).toBe(OperationType.STEP);
      expect(result.SubType).toBe("CustomSubType");
      expect(result.StartTimestamp).toEqual(
        new Date("2023-01-01T00:00:00.000Z"),
      );
      expect(result.ParentId).toBe("parent-id");
      expect(result.Status).toBe(OperationStatus.SUCCEEDED);
      expect(result.EndTimestamp).toBeInstanceOf(Date);
      expect(result.StepDetails?.Attempt).toBe(2);
    });
  });
});
