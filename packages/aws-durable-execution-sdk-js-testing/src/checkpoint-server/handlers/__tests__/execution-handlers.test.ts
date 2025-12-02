import { ErrorObject, EventType } from "@aws-sdk/client-lambda";
import {
  processStartDurableExecution,
  processStartInvocation,
  processCompleteInvocation,
} from "../execution-handlers";
import { ExecutionManager } from "../../storage/execution-manager";
import {
  createExecutionId,
  createInvocationId,
} from "../../utils/tagged-strings";

describe("execution handlers", () => {
  let executionManager: ExecutionManager;

  beforeEach(() => {
    executionManager = new ExecutionManager();
  });

  afterEach(() => {
    executionManager.cleanup();
  });

  describe("processStartDurableExecution", () => {
    it("should delegate to execution manager startExecution with generated execution ID", () => {
      const startExecutionSpy = jest.spyOn(executionManager, "startExecution");

      const payload = '{"test": "execution data"}';
      const result = processStartDurableExecution(payload, executionManager);

      expect(startExecutionSpy).toHaveBeenCalledWith({
        payload,
        executionId: expect.any(String),
      });

      expect(result).toEqual({
        checkpointToken: expect.any(String),
        executionId: expect.any(String),
        invocationId: expect.any(String),
        operationEvents: expect.any(Array),
      });
    });
  });

  describe("processStartInvocation", () => {
    it("should delegate to execution manager startInvocation with converted execution ID", () => {
      // First create an execution
      const payload = '{"test": "data"}';
      executionManager.startExecution({
        executionId: createExecutionId("test-execution-id"),
        payload,
      });

      const startInvocationSpy = jest.spyOn(
        executionManager,
        "startInvocation",
      );

      const result = processStartInvocation(
        "test-execution-id",
        executionManager,
      );

      expect(startInvocationSpy).toHaveBeenCalledWith(
        createExecutionId("test-execution-id"),
      );
      expect(result).toEqual({
        checkpointToken: expect.any(String),
        executionId: createExecutionId("test-execution-id"),
        invocationId: expect.any(String),
        operationEvents: expect.any(Array),
      });
    });

    it("should propagate errors when execution manager cannot find execution", () => {
      const startInvocationSpy = jest
        .spyOn(executionManager, "startInvocation")
        .mockImplementation(() => {
          throw new Error("Execution not found");
        });

      expect(() =>
        processStartInvocation("non-existent-execution", executionManager),
      ).toThrow("Execution not found");

      expect(startInvocationSpy).toHaveBeenCalledWith(
        createExecutionId("non-existent-execution"),
      );
    });
  });

  describe("processCompleteInvocation", () => {
    it("should delegate to execution manager completeInvocation with all parameters", () => {
      // First create an execution and invocation
      const executionId = createExecutionId("test-execution-id");
      const invocationId = createInvocationId("test-invocation-id");
      executionManager.startExecution({ executionId, payload: "{}" });

      const completeInvocationSpy = jest.spyOn(
        executionManager,
        "completeInvocation",
      );

      // Mock the return value
      const mockEvent = {
        EventType: EventType.InvocationCompleted,
        Timestamp: new Date(),
        InvocationCompletedDetails: {
          StartTimestamp: new Date(),
          EndTimestamp: new Date(),
          RequestId: invocationId,
          Error: { Payload: undefined },
        },
      };
      completeInvocationSpy.mockReturnValue(mockEvent);

      const errorObject: ErrorObject = {
        ErrorType: "TestError",
        ErrorMessage: "Test invocation error",
      };

      const result = processCompleteInvocation(
        executionId,
        invocationId,
        errorObject,
        executionManager,
      );

      expect(completeInvocationSpy).toHaveBeenCalledWith(
        executionId,
        invocationId,
        errorObject,
      );
      expect(result).toEqual(mockEvent);
    });
  });
});
