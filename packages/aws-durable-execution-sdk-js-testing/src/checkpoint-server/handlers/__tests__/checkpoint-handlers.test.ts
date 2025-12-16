import {
  CheckpointDurableExecutionRequest,
  InvalidParameterValueException,
  OperationType,
  OperationAction,
  OperationStatus,
  ErrorObject,
} from "@aws-sdk/client-lambda";
import {
  processPollCheckpointData,
  processUpdateCheckpointData,
  processCheckpointDurableExecution,
} from "../checkpoint-handlers";
import { ExecutionManager } from "../../storage/execution-manager";
import {
  createExecutionId,
  createInvocationId,
} from "../../utils/tagged-strings";
import { encodeCheckpointToken } from "../../utils/checkpoint-token";

// Mock only external dependencies we can't control
jest.mock("crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("mocked-uuid-token"),
}));

describe("checkpoint handlers", () => {
  let executionManager: ExecutionManager;
  let mockExecutionId: ReturnType<typeof createExecutionId>;

  const createExecutionWithOperations = (executionId = mockExecutionId) => {
    const invocationResult = executionManager.startExecution({
      executionId,
      payload: '{"test": "data"}',
      invocationId: createInvocationId(),
    });

    const storage = executionManager.getCheckpointsByExecution(executionId);

    // Add some test operations
    const stepUpdate = {
      Id: "test-step-op",
      Type: OperationType.STEP,
      Action: OperationAction.START,
      Name: "TestStep",
    };
    storage!.registerUpdate(stepUpdate);

    return { storage: storage!, invocationResult };
  };

  beforeEach(() => {
    executionManager = new ExecutionManager();
    mockExecutionId = createExecutionId("test-execution-id");
    jest.clearAllMocks();
  });

  afterEach(() => {
    executionManager.cleanup();
  });

  describe("processPollCheckpointData", () => {
    it("should look up storage and return pending checkpoint updates", async () => {
      const { storage } = createExecutionWithOperations();

      const getStorageSpy = jest.spyOn(
        executionManager,
        "getCheckpointsByExecution",
      );
      const getPendingSpy = jest.spyOn(storage, "getPendingCheckpointUpdates");

      // Mock getPendingCheckpointUpdates to resolve immediately with test data
      const mockOperations = [
        {
          operation: {
            Id: "test-op-1",
            Type: OperationType.STEP,
            Status: OperationStatus.STARTED,
            StartTimestamp: new Date(),
          },
          events: [],
          update: undefined,
        },
      ];
      getPendingSpy.mockResolvedValue(mockOperations);

      const result = await processPollCheckpointData(
        "test-execution-id",
        executionManager,
      );

      expect(getStorageSpy).toHaveBeenCalledWith(
        createExecutionId("test-execution-id"),
      );
      expect(getPendingSpy).toHaveBeenCalled();
      expect(result).toEqual({ operations: mockOperations });
    });

    it("should throw error when execution manager cannot find storage", async () => {
      const getStorageSpy = jest
        .spyOn(executionManager, "getCheckpointsByExecution")
        .mockReturnValue(undefined);

      await expect(
        processPollCheckpointData("non-existent-execution", executionManager),
      ).rejects.toThrow("Execution not found");

      expect(getStorageSpy).toHaveBeenCalledWith(
        createExecutionId("non-existent-execution"),
      );
    });
  });

  describe("processUpdateCheckpointData", () => {
    it("should look up storage and update specific operation", () => {
      const { storage } = createExecutionWithOperations();

      const getStorageSpy = jest.spyOn(
        executionManager,
        "getCheckpointsByExecution",
      );
      const hasOperationSpy = jest.spyOn(storage, "hasOperation");
      const updateOperationSpy = jest.spyOn(storage, "updateOperation");

      const operationData = { Status: OperationStatus.SUCCEEDED };
      const payload = '{"result": "success"}';
      const error: ErrorObject = { ErrorType: "TestError" };

      const mockResult = {
        operation: {
          Id: "test-step-op",
          Type: OperationType.STEP,
          Status: OperationStatus.SUCCEEDED,
          StartTimestamp: new Date(),
        },
        events: [],
      };
      hasOperationSpy.mockReturnValue(true);
      updateOperationSpy.mockReturnValue(mockResult);

      const result = processUpdateCheckpointData(
        "test-execution-id",
        "test-step-op",
        operationData,
        payload,
        error,
        executionManager,
      );

      expect(getStorageSpy).toHaveBeenCalledWith(
        createExecutionId("test-execution-id"),
      );
      expect(hasOperationSpy).toHaveBeenCalledWith("test-step-op");
      expect(updateOperationSpy).toHaveBeenCalledWith(
        "test-step-op",
        operationData,
        payload,
        error,
      );
      expect(result).toEqual({
        operation: {
          Id: "test-step-op",
          Type: OperationType.STEP,
          Status: OperationStatus.SUCCEEDED,
          StartTimestamp: expect.any(Date),
        },
        events: [],
      });
    });

    it("should throw error when execution not found", () => {
      const getStorageSpy = jest
        .spyOn(executionManager, "getCheckpointsByExecution")
        .mockReturnValue(undefined);

      expect(() => {
        processUpdateCheckpointData(
          "non-existent-execution",
          "test-op",
          { Status: OperationStatus.SUCCEEDED },
          undefined,
          undefined,
          executionManager,
        );
      }).toThrow("Execution not found");

      expect(getStorageSpy).toHaveBeenCalledWith(
        createExecutionId("non-existent-execution"),
      );
    });

    it("should throw error when operation not found in storage", () => {
      const { storage } = createExecutionWithOperations();

      const hasOperationSpy = jest
        .spyOn(storage, "hasOperation")
        .mockReturnValue(false);

      expect(() => {
        processUpdateCheckpointData(
          "test-execution-id",
          "non-existent-operation",
          { Status: OperationStatus.SUCCEEDED },
          undefined,
          undefined,
          executionManager,
        );
      }).toThrow("Operation not found");

      expect(hasOperationSpy).toHaveBeenCalledWith("non-existent-operation");
    });
  });

  describe("processCheckpointDurableExecution", () => {
    it("should look up storage, validate, process updates, and return new checkpoint token", () => {
      const executionArn = "test-execution-arn";
      const executionId = createExecutionId(executionArn);
      const { storage, invocationResult } =
        createExecutionWithOperations(executionId);

      const getStorageSpy = jest.spyOn(
        executionManager,
        "getCheckpointsByExecution",
      );
      const registerUpdatesSpy = jest.spyOn(storage, "registerUpdates");

      const input: CheckpointDurableExecutionRequest = {
        DurableExecutionArn: executionArn,
        CheckpointToken: encodeCheckpointToken({
          executionId,
          invocationId: invocationResult.invocationId,
          token: "test-token",
        }),
        Updates: [
          {
            Id: "test-update-op",
            Type: OperationType.STEP,
            Action: OperationAction.SUCCEED,
            Payload: "test result",
          },
        ],
      };

      const result = processCheckpointDurableExecution(
        executionArn,
        input,
        executionManager,
      );

      expect(getStorageSpy).toHaveBeenCalledWith(executionId);
      expect(registerUpdatesSpy).toHaveBeenCalledWith(input.Updates);

      expect(result.CheckpointToken).toBeDefined();
      expect(result.NewExecutionState?.Operations).toEqual([
        {
          Id: "test-step-op",
          Name: "TestStep",
          StartTimestamp: expect.any(Date),
          Status: "STARTED",
          Type: "STEP",
        },
        {
          EndTimestamp: expect.any(Date),
          Id: "test-update-op",
          StartTimestamp: expect.any(Date),
          Status: "SUCCEEDED",
          StepDetails: { Attempt: 1, Result: "test result" },
          Type: "STEP",
        },
      ]);
      expect(result.NewExecutionState?.NextMarker).toBeUndefined();
    });

    it("should throw error when execution not found", () => {
      const getStorageSpy = jest
        .spyOn(executionManager, "getCheckpointsByExecution")
        .mockReturnValue(undefined);

      const input: CheckpointDurableExecutionRequest = {
        DurableExecutionArn: "non-existent-arn",
        CheckpointToken: "valid-token",
        Updates: [],
      };

      expect(() => {
        processCheckpointDurableExecution(
          "non-existent-arn",
          input,
          executionManager,
        );
      }).toThrow("Execution not found");

      expect(getStorageSpy).toHaveBeenCalledWith(
        createExecutionId("non-existent-arn"),
      );
    });

    it("should throw error when checkpoint token is missing", () => {
      const executionArn = "test-execution-arn";
      const executionId = createExecutionId(executionArn);
      createExecutionWithOperations(executionId);

      const input: CheckpointDurableExecutionRequest = {
        DurableExecutionArn: executionArn,
        CheckpointToken: undefined,
        Updates: [],
      };

      expect(() => {
        processCheckpointDurableExecution(
          executionArn,
          input,
          executionManager,
        );
      }).toThrow(InvalidParameterValueException);
    });

    it("should handle empty updates gracefully", () => {
      const executionArn = "test-execution-arn";
      const executionId = createExecutionId(executionArn);
      const { storage, invocationResult } =
        createExecutionWithOperations(executionId);

      const registerUpdatesSpy = jest.spyOn(storage, "registerUpdates");

      const input: CheckpointDurableExecutionRequest = {
        DurableExecutionArn: executionArn,
        CheckpointToken: encodeCheckpointToken({
          executionId,
          invocationId: invocationResult.invocationId,
          token: "test-token",
        }),
        Updates: [],
      };

      const result = processCheckpointDurableExecution(
        executionArn,
        input,
        executionManager,
      );

      expect(registerUpdatesSpy).toHaveBeenCalledWith([]);
      expect(result.CheckpointToken).toBeDefined();
      expect(result.NewExecutionState?.Operations).toEqual([
        {
          Id: "test-step-op",
          Name: "TestStep",
          StartTimestamp: expect.any(Date),
          Status: "STARTED",
          Type: "STEP",
        },
      ]);
    });

    it("should generate new checkpoint token with different UUID", () => {
      const executionArn = "test-execution-arn";
      const executionId = createExecutionId(executionArn);
      const { invocationResult } = createExecutionWithOperations(executionId);

      const input: CheckpointDurableExecutionRequest = {
        DurableExecutionArn: executionArn,
        CheckpointToken: encodeCheckpointToken({
          executionId,
          invocationId: invocationResult.invocationId,
          token: "original-token",
        }),
        Updates: [],
      };

      const result = processCheckpointDurableExecution(
        executionArn,
        input,
        executionManager,
      );

      // Should have a new token (mocked to "mocked-uuid-token")
      const expectedNewToken = encodeCheckpointToken({
        executionId,
        invocationId: invocationResult.invocationId,
        token: "mocked-uuid-token",
      });

      expect(result.CheckpointToken).toEqual(expectedNewToken);
      expect(result.NewExecutionState?.Operations).toEqual([
        {
          Id: "test-step-op",
          Name: "TestStep",
          StartTimestamp: expect.any(Date),
          Status: "STARTED",
          Type: "STEP",
        },
      ]);
    });

    it("should include changed operations from storage in response", () => {
      const executionArn = "test-execution-arn";
      const executionId = createExecutionId(executionArn);
      const { storage, invocationResult } =
        createExecutionWithOperations(executionId);

      // Add more operations to verify they're all included
      storage.registerUpdate({
        Id: "another-op",
        Type: OperationType.WAIT,
        Action: OperationAction.START,
        WaitOptions: { WaitSeconds: 30 },
      });

      const input: CheckpointDurableExecutionRequest = {
        DurableExecutionArn: executionArn,
        CheckpointToken: encodeCheckpointToken({
          executionId,
          invocationId: invocationResult.invocationId,
          token: "test-token",
        }),
        Updates: [],
      };

      const result = processCheckpointDurableExecution(
        executionArn,
        input,
        executionManager,
      );

      expect(result.CheckpointToken).toBeDefined();
      expect(result.NewExecutionState?.Operations).toEqual([
        {
          Id: "test-step-op",
          Name: "TestStep",
          StartTimestamp: expect.any(Date),
          Status: "STARTED",
          Type: "STEP",
        },
        {
          Id: "another-op",
          StartTimestamp: expect.any(Date),
          Status: "STARTED",
          Type: "WAIT",
          WaitDetails: { ScheduledEndTimestamp: expect.any(Date) },
        },
      ]);
      expect(result.NewExecutionState?.NextMarker).toBeUndefined();
    });

    it("should call getDirtyOperations to return only changed operations", () => {
      const executionArn = "test-execution-arn";
      const executionId = createExecutionId(executionArn);
      const { storage, invocationResult } =
        createExecutionWithOperations(executionId);

      const getDirtyOperationsSpy = jest.spyOn(storage, "getDirtyOperations");
      getDirtyOperationsSpy.mockReturnValue([
        {
          Id: "dirty-op-1",
          Type: OperationType.STEP,
          Status: OperationStatus.STARTED,
          StartTimestamp: new Date(),
        },
        {
          Id: "dirty-op-2",
          Type: OperationType.CALLBACK,
          Status: OperationStatus.SUCCEEDED,
          StartTimestamp: new Date(),
        },
      ]);

      const input: CheckpointDurableExecutionRequest = {
        DurableExecutionArn: executionArn,
        CheckpointToken: encodeCheckpointToken({
          executionId,
          invocationId: invocationResult.invocationId,
          token: "test-token",
        }),
        Updates: [
          {
            Id: "new-op",
            Type: OperationType.STEP,
            Action: OperationAction.START,
          },
        ],
      };

      const result = processCheckpointDurableExecution(
        executionArn,
        input,
        executionManager,
      );

      expect(getDirtyOperationsSpy).toHaveBeenCalledTimes(1);
      expect(result.NewExecutionState?.Operations).toEqual([
        {
          Id: "dirty-op-1",
          Type: OperationType.STEP,
          Status: OperationStatus.STARTED,
          StartTimestamp: expect.any(Date),
        },
        {
          Id: "dirty-op-2",
          Type: OperationType.CALLBACK,
          Status: OperationStatus.SUCCEEDED,
          StartTimestamp: expect.any(Date),
        },
      ]);
    });
  });
});
