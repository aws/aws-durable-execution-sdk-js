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
      const invocationId = "mock-invocation-id";
      const result = processStartDurableExecution(
        {
          payload,
          invocationId: createInvocationId(invocationId),
        },
        executionManager,
      );

      expect(startExecutionSpy).toHaveBeenCalledWith({
        payload,
        invocationId: invocationId,
        executionId: expect.any(String),
      });

      expect(result).toEqual({
        checkpointToken: expect.any(String),
        executionId: expect.any(String),
        invocationId: invocationId,
        operationEvents: expect.any(Array),
      });
    });
  });

  describe("processStartInvocation", () => {
    it("should delegate to execution manager startInvocation with converted execution ID", () => {
      // First create an execution
      const payload = '{"test": "data"}';
      executionManager.startExecution({
        invocationId: createInvocationId(),
        executionId: createExecutionId("test-execution-id"),
        payload,
      });

      const startInvocationSpy = jest.spyOn(
        executionManager,
        "startInvocation",
      );

      const executionId = createExecutionId("test-execution-id");
      const invocationId = createInvocationId("test-invocation-id");
      const result = processStartInvocation(
        {
          executionId,
          invocationId,
        },
        executionManager,
      );

      expect(startInvocationSpy).toHaveBeenCalledWith({
        executionId,
        invocationId,
      });
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

      const executionId = createExecutionId("non-existent-execution");
      const invocationId = createInvocationId("test-invocation-id");

      expect(() =>
        processStartInvocation(
          {
            executionId,
            invocationId,
          },
          executionManager,
        ),
      ).toThrow("Execution not found");

      expect(startInvocationSpy).toHaveBeenCalledWith({
        executionId,
        invocationId,
      });
    });
  });

  describe("processCompleteInvocation", () => {
    it("should delegate to execution manager completeInvocation with all parameters", () => {
      // First create an execution and invocation
      const executionId = createExecutionId("test-execution-id");
      const invocationId = createInvocationId("test-invocation-id");
      executionManager.startExecution({
        executionId,
        payload: "{}",
        invocationId: createInvocationId(),
      });

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
