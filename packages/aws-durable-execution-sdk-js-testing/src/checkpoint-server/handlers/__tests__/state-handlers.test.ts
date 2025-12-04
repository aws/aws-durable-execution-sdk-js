import { OperationType, OperationAction } from "@aws-sdk/client-lambda";
import { processGetDurableExecutionState } from "../state-handlers";
import { ExecutionManager } from "../../storage/execution-manager";
import {
  createExecutionId,
  createInvocationId,
} from "../../utils/tagged-strings";

describe("state handlers", () => {
  let executionManager: ExecutionManager;

  beforeEach(() => {
    executionManager = new ExecutionManager();
  });

  afterEach(() => {
    executionManager.cleanup();
  });

  describe("processGetDurableExecutionState", () => {
    it("should look up storage and return execution state", () => {
      // Create an execution with some operations
      const executionId = createExecutionId("test-execution-arn");
      executionManager.startExecution({
        executionId,
        payload: '{"test": "data"}',
        invocationId: createInvocationId(),
      });

      const storage = executionManager.getCheckpointsByExecution(executionId);
      storage!.registerUpdate({
        Id: "test-step",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        Name: "TestStep",
      });

      const getStorageSpy = jest.spyOn(
        executionManager,
        "getCheckpointsByExecution",
      );
      const getStateSpy = jest.spyOn(storage!, "getState");

      const result = processGetDurableExecutionState(
        "test-execution-arn",
        executionManager,
      );

      expect(getStorageSpy).toHaveBeenCalledWith(
        createExecutionId("test-execution-arn"),
      );
      expect(getStateSpy).toHaveBeenCalled();
      expect(result).toEqual({
        Operations: expect.any(Array),
        NextMarker: undefined,
      });
      expect(result.Operations?.length).toBeGreaterThan(0);
    });

    it("should throw error when execution manager cannot find storage", () => {
      const getStorageSpy = jest
        .spyOn(executionManager, "getCheckpointsByExecution")
        .mockReturnValue(undefined);

      expect(() => {
        processGetDurableExecutionState("non-existent-arn", executionManager);
      }).toThrow("Execution not found");

      expect(getStorageSpy).toHaveBeenCalledWith(
        createExecutionId("non-existent-arn"),
      );
    });
  });
});
