import { CheckpointHandler } from "./checkpoint";
import { ExecutionContext, OperationSubType } from "../../types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import {
  CheckpointDurableExecutionResponse,
  Operation,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { randomUUID } from "crypto";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import { getStepData } from "../step-id-utils/step-id-utils";

describe("CheckpointHandler - StepData Update", () => {
  let mockContext: ExecutionContext;
  let mockState: any;
  let checkpointHandler: CheckpointHandler;

  beforeEach(() => {
    mockState = {
      checkpoint: jest.fn(),
    };

    const stepData = {
      "existing-step": {
        Id: "existing-step",
        Status: OperationStatus.STARTED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      },
    };
    mockContext = {
      executionContextId: randomUUID(),
      customerHandlerEvent: {},
      state: mockState,
      _stepData: stepData,
      terminationManager: new TerminationManager(),
      durableExecutionArn:
        "arn:aws:durable-execution:us-east-1:123456789012:execution/test-execution",
      isLocalMode: false,
      isVerbose: process.env.DURABLE_VERBOSE_MODE === "true",
      getStepData: jest.fn((stepId: string) => {
        return getStepData(stepData, stepId);
      }),
    };

    checkpointHandler = new CheckpointHandler(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );
  });

  it("should update stepData with operations from checkpoint response", async () => {
    // Arrange
    const newOperations: Operation[] = [
      {
        Id: "step-1",
        Status: OperationStatus.SUCCEEDED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        Name: "test-step-1",
        StepDetails: {
          Result: "success-result",
          Attempt: 1,
        },
      },
      {
        Id: "step-2",
        Status: OperationStatus.FAILED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        Name: "test-step-2",
        StepDetails: {
          Result: "error-message",
          Attempt: 2,
        },
      },
    ];

    const checkpointResponse: CheckpointDurableExecutionResponse = {
      CheckpointToken: "new-token",
      NewExecutionState: {
        Operations: newOperations,
      },
    };

    mockState.checkpoint.mockResolvedValue(checkpointResponse);

    // Act
    await checkpointHandler.checkpoint("test-step", {
      Action: "SUCCEED",
      SubType: OperationSubType.STEP,
      Type: OperationType.STEP,
    });

    // Assert
    expect(mockContext._stepData["step-1"]).toEqual(newOperations[0]);
    expect(mockContext._stepData["step-2"]).toEqual(newOperations[1]);
    expect(mockContext._stepData["existing-step"]).toBeDefined(); // Should preserve existing data
  });

  it("should update existing stepData entries when operations have same ID", async () => {
    // Arrange
    const updatedOperation: Operation = {
      Id: "existing-step",
      Status: OperationStatus.SUCCEEDED,
      SubType: OperationSubType.STEP,
      Type: OperationType.STEP,
      Name: "updated-step",
      StepDetails: {
        Result: "final-result",
        Attempt: 1,
      },
    };

    const checkpointResponse: CheckpointDurableExecutionResponse = {
      CheckpointToken: "new-token",
      NewExecutionState: {
        Operations: [updatedOperation],
      },
    };

    mockState.checkpoint.mockResolvedValue(checkpointResponse);

    // Act
    await checkpointHandler.checkpoint("existing-step", {
      Action: "SUCCEED",
      SubType: OperationSubType.STEP,
      Type: OperationType.STEP,
    });

    // Assert
    expect(mockContext._stepData["existing-step"]).toEqual(updatedOperation);
    expect(mockContext._stepData["existing-step"].Status).toBe(
      OperationStatus.SUCCEEDED,
    );
    expect(mockContext._stepData["existing-step"].StepDetails?.Result).toBe(
      "final-result",
    );
  });

  it("should handle checkpoint response without newExecutionState", async () => {
    // Arrange
    const checkpointResponse: CheckpointDurableExecutionResponse = {
      CheckpointToken: "new-token",
      // No NewExecutionState
    };

    mockState.checkpoint.mockResolvedValue(checkpointResponse);
    const originalStepData = { ...mockContext._stepData };

    // Act
    await checkpointHandler.checkpoint("test-step", {
      Action: "SUCCEED",
      SubType: OperationSubType.STEP,
      Type: OperationType.STEP,
    });

    // Assert
    expect(mockContext._stepData).toEqual(originalStepData); // Should remain unchanged
  });

  it("should handle checkpoint response with empty operations array", async () => {
    // Arrange
    const checkpointResponse: CheckpointDurableExecutionResponse = {
      CheckpointToken: "new-token",
      NewExecutionState: {
        Operations: [],
      },
    };

    mockState.checkpoint.mockResolvedValue(checkpointResponse);
    const originalStepData = { ...mockContext._stepData };

    // Act
    await checkpointHandler.checkpoint("test-step", {
      Action: "SUCCEED",
      SubType: OperationSubType.STEP,
      Type: OperationType.STEP,
    });

    // Assert
    expect(mockContext._stepData).toEqual(originalStepData); // Should remain unchanged
  });

  it("should ignore operations without ID", async () => {
    // Arrange
    const operationsWithoutId: Operation[] = [
      {
        // No Id field
        Status: OperationStatus.SUCCEEDED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        Name: "no-id-step",
      },
      {
        Id: "valid-step",
        Status: OperationStatus.SUCCEEDED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        Name: "valid-step",
      },
    ];

    const checkpointResponse: CheckpointDurableExecutionResponse = {
      CheckpointToken: "new-token",
      NewExecutionState: {
        Operations: operationsWithoutId,
      },
    };

    mockState.checkpoint.mockResolvedValue(checkpointResponse);

    // Act
    await checkpointHandler.checkpoint("test-step", {
      Action: "SUCCEED",
      SubType: OperationSubType.STEP,
      Type: OperationType.STEP,
    });

    // Assert
    expect(mockContext._stepData["valid-step"]).toEqual(operationsWithoutId[1]);
    expect(Object.keys(mockContext._stepData)).not.toContain(""); // No empty key should be added
    expect(Object.keys(mockContext._stepData)).not.toContain(undefined); // No undefined key
  });

  it("should handle batched checkpoint operations", async () => {
    // Arrange
    const batchOperations: Operation[] = [
      {
        Id: "batch-step-1",
        Status: OperationStatus.SUCCEEDED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      },
      {
        Id: "batch-step-2",
        Status: OperationStatus.SUCCEEDED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      },
    ];

    const checkpointResponse: CheckpointDurableExecutionResponse = {
      CheckpointToken: "new-token",
      NewExecutionState: {
        Operations: batchOperations,
      },
    };

    mockState.checkpoint.mockResolvedValue(checkpointResponse);

    // Act - Make multiple checkpoint calls that should be batched
    const promise1 = checkpointHandler.checkpoint("batch-step-1", {
      Action: "SUCCEED",
      SubType: OperationSubType.STEP,
      Type: OperationType.STEP,
    });

    const promise2 = checkpointHandler.checkpoint("batch-step-2", {
      Action: "SUCCEED",
      SubType: OperationSubType.STEP,
      Type: OperationType.STEP,
    });

    await Promise.all([promise1, promise2]);

    // Assert
    expect(mockState.checkpoint).toHaveBeenCalledTimes(1); // Should be batched into single call
    expect(mockContext._stepData["batch-step-1"]).toEqual(batchOperations[0]);
    expect(mockContext._stepData["batch-step-2"]).toEqual(batchOperations[1]);
  });
});
