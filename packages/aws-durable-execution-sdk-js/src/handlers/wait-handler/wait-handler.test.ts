import {
  createMockCheckpoint,
  CheckpointFunction,
} from "../../testing/mock-checkpoint";
import { createWaitHandler } from "./wait-handler";
import {
  OperationStatus,
  OperationType,
  Operation,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { ExecutionContext, OperationSubType } from "../../types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { OperationInterceptor } from "../../mocks/operation-interceptor";
import { hashId, getStepData } from "../../utils/step-id-utils/step-id-utils";

// Mock the logger to avoid console output during tests
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

describe("Wait Handler", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockCheckpoint: jest.MockedFunction<CheckpointFunction>;
  let createStepId: jest.Mock;
  let waitHandler: ReturnType<typeof createWaitHandler>;
  let mockTerminationManager: jest.Mocked<TerminationManager>;

  beforeEach(() => {
    // Reset all mocks before each test to ensure isolation
    jest.resetAllMocks();

    // Create a mock termination manager
    mockTerminationManager = {
      terminate: jest.fn(),
      getTerminationPromise: jest.fn(),
    } as unknown as jest.Mocked<TerminationManager>;

    const stepData = {};
    mockExecutionContext = {
      _stepData: stepData,
      terminationManager: mockTerminationManager,
      getStepData: jest.fn((stepId: string) => {
        return getStepData(stepData, stepId);
      }),
    } as unknown as jest.Mocked<ExecutionContext>;

    mockCheckpoint = createMockCheckpoint();
    createStepId = jest.fn().mockReturnValue("test-step-id");
    waitHandler = createWaitHandler(
      mockExecutionContext,
      mockCheckpoint,
      createStepId,
      jest.fn(() => false), // hasRunningOperations
    );
  });

  test("should skip execution if step is already completed", async () => {
    // Set up a step that was already completed
    const stepData = mockExecutionContext._stepData as any;
    stepData[hashId("test-step-id")] = {
      Id: "test-step-id",
      Status: OperationStatus.SUCCEEDED,
    } as Operation;

    await waitHandler("test-wait", 1);

    // Verify checkpoint was not called
    expect(mockCheckpoint).not.toHaveBeenCalled();
    // Verify terminate was not called
    expect(mockTerminationManager.terminate).not.toHaveBeenCalled();
  });

  test("should accept undefined as name parameter", async () => {
    // Call the wait handler with undefined name
    waitHandler(500);

    // Wait a small amount of time for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the checkpoint was called with undefined name
    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      Id: "test-step-id",
      ParentId: undefined,
      Action: "START",
      SubType: OperationSubType.WAIT,
      Type: OperationType.WAIT,
      Name: undefined,
      WaitOptions: {
        WaitSeconds: 500,
      },
    });

    // Verify termination was called
    expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.WAIT_SCHEDULED,
      message: "Operation test-step-id scheduled to wait",
    });
  });

  test("should checkpoint at start and terminate with WAIT_SCHEDULED reason", async () => {
    // Call the wait handler but don't await it (it will never resolve)
    waitHandler("test-wait", 1);

    // Wait a small amount of time for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the checkpoint was called with started status
    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      Id: "test-step-id",
      Action: "START",
      SubType: OperationSubType.WAIT,
      Type: OperationType.WAIT,
      Name: "test-wait",
      WaitOptions: {
        WaitSeconds: 1,
      },
    });

    // Verify terminate was called with WAIT_SCHEDULED reason
    expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.WAIT_SCHEDULED,
      message: "Operation test-wait scheduled to wait",
    });
  });

  test("should use stepId as message when name is not provided", async () => {
    // Call the wait handler but don't await it (it will never resolve)
    waitHandler(1);

    // Wait a small amount of time for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify terminate was called with stepId in the message
    expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.WAIT_SCHEDULED,
      message: "Operation test-step-id scheduled to wait",
    });
  });

  describe("Mock Integration", () => {
    beforeEach(() => {
      // Clear mocks before each test
      OperationInterceptor.clearAll();
      mockExecutionContext.durableExecutionArn = "test-execution-arn";
    });

    test("should throw error when trying to mock wait operations", async () => {
      const mockCallback = jest.fn().mockResolvedValue("mocked-wait");

      // Register a mock for the wait operation
      OperationInterceptor.forExecution(
        mockExecutionContext.durableExecutionArn,
      )
        .onName("test-wait")
        .mock(mockCallback);

      // Wait handler should throw an error when mocks are detected
      await expect(waitHandler("test-wait", 1)).rejects.toThrow(
        "Wait step cannot be mocked",
      );

      // Mock should not have been called
      expect(mockCallback).not.toHaveBeenCalled();
      // Checkpoint should not have been called due to early error
      expect(mockCheckpoint).not.toHaveBeenCalled();
    });

    test("should throw error for index-based mocks on wait operations", async () => {
      const mockCallback = jest.fn().mockResolvedValue("mocked-wait");

      // Register an index-based mock (first operation = index 0)
      OperationInterceptor.forExecution(
        mockExecutionContext.durableExecutionArn,
      )
        .onIndex(0)
        .mock(mockCallback);

      // Wait handler should throw an error when mocks are detected
      await expect(waitHandler(1)).rejects.toThrow(
        "Wait step cannot be mocked",
      );

      // Mock should not have been called
      expect(mockCallback).not.toHaveBeenCalled();
    });

    test("should prevent mocking on all wait operations", async () => {
      const mockCallback1 = jest.fn().mockResolvedValue("wait-1");
      const mockCallback2 = jest.fn().mockResolvedValue("wait-2");

      // Register mocks for different wait operations
      OperationInterceptor.forExecution(
        mockExecutionContext.durableExecutionArn,
      )
        .onName("wait-1")
        .mock(mockCallback1);

      OperationInterceptor.forExecution(
        mockExecutionContext.durableExecutionArn,
      )
        .onName("wait-2")
        .mock(mockCallback2);

      // Both should throw errors
      await expect(waitHandler("wait-1", 500)).rejects.toThrow(
        "Wait step cannot be mocked",
      );

      await expect(waitHandler("wait-2", 1)).rejects.toThrow(
        "Wait step cannot be mocked",
      );

      // No mocks should have been called
      expect(mockCallback1).not.toHaveBeenCalled();
      expect(mockCallback2).not.toHaveBeenCalled();
    });

    test("should skip already completed wait operations regardless of mocks", async () => {
      const mockCallback = jest.fn().mockResolvedValue("mocked-wait");

      // Register a mock
      OperationInterceptor.forExecution(
        mockExecutionContext.durableExecutionArn,
      )
        .onName("completed-wait")
        .mock(mockCallback);

      // Set up a wait that was already completed
      const stepData = mockExecutionContext._stepData as any;
      stepData[hashId("test-step-id")] = {
        Id: "test-step-id",
        Status: OperationStatus.SUCCEEDED,
      } as Operation;

      await waitHandler("completed-wait", 1);

      // Should skip execution entirely (no mock check occurs for completed operations)
      expect(mockCheckpoint).not.toHaveBeenCalled();
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe("running operations awareness", () => {
    test("should terminate immediately when no operations are running", async () => {
      const mockHasRunningOperations = jest.fn(() => false);
      waitHandler = createWaitHandler(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      waitHandler("test-wait", 1);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(
        mockExecutionContext.terminationManager.terminate,
      ).toHaveBeenCalledWith({
        reason: TerminationReason.WAIT_SCHEDULED,
        message: "Operation test-wait scheduled to wait",
      });
      expect(mockHasRunningOperations).toHaveBeenCalled();
    });

    test("should not checkpoint START if step data already exists", async () => {
      mockExecutionContext.getStepData.mockReturnValue({
        Status: OperationStatus.STARTED,
        WaitDetails: { ScheduledTimestamp: new Date(Date.now() + 5000) },
      } as Operation);

      const mockHasRunningOperations = jest.fn(() => false);
      waitHandler = createWaitHandler(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      waitHandler("test-wait", 1);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockCheckpoint).not.toHaveBeenCalled();
    });

    test("should checkpoint START only on first execution", async () => {
      mockExecutionContext.getStepData.mockReturnValue(undefined);

      const mockHasRunningOperations = jest.fn(() => false);
      waitHandler = createWaitHandler(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      waitHandler("test-wait", 1);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
        Id: "test-step-id",
        ParentId: undefined,
        Action: OperationAction.START,
        SubType: OperationSubType.WAIT,
        Type: OperationType.WAIT,
        Name: "test-wait",
        WaitOptions: {
          WaitSeconds: 1,
        },
      });
    });

    test("should wait for operations to complete before terminating", async () => {
      let operationsRunning = true;
      const mockHasRunningOperations = jest.fn(() => operationsRunning);

      // Mock step data with existing wait
      mockExecutionContext.getStepData.mockReturnValue({
        Status: OperationStatus.STARTED,
        WaitDetails: { ScheduledTimestamp: new Date(Date.now() + 5000) },
      } as Operation);

      waitHandler = createWaitHandler(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      // Start the wait handler (don't await - it will wait for operations)
      const waitPromise = waitHandler("test-wait", 1);

      // Give it time to enter the waiting logic
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not terminate immediately since operations are running
      expect(
        mockExecutionContext.terminationManager.terminate,
      ).not.toHaveBeenCalled();
      expect(mockHasRunningOperations).toHaveBeenCalled();

      // Simulate operations completing after 150ms
      setTimeout(() => {
        operationsRunning = false;
      }, 150);

      // Wait for the polling to detect the change and terminate
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Should eventually terminate when operations complete
      expect(
        mockExecutionContext.terminationManager.terminate,
      ).toHaveBeenCalledWith({
        reason: TerminationReason.WAIT_SCHEDULED,
        message: "Operation test-wait scheduled to wait",
      });
    });

    test("should handle wait during parallel execution with running step", async () => {
      // This integration test simulates:
      // ctx.parallel([
      //   branch1: ctx.wait(2 sec),
      //   branch2: ctx.step (that has internal wait for 3 second)
      // ])

      let operationsRunning = true;
      const mockHasRunningOperations = jest.fn(() => operationsRunning);

      // Mock step data for wait operation (2 second wait)
      const waitTime = Date.now() + 2000;
      mockExecutionContext.getStepData.mockReturnValue({
        Status: OperationStatus.STARTED,
        WaitDetails: { ScheduledTimestamp: new Date(waitTime) },
      } as Operation);

      waitHandler = createWaitHandler(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      // Start wait handler - should detect running operations and wait
      const waitPromise = waitHandler("parallel-wait", 2000);

      // Give time for wait handler to enter complex waiting logic
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not terminate immediately due to running operations
      expect(
        mockExecutionContext.terminationManager.terminate,
      ).not.toHaveBeenCalled();
      expect(mockHasRunningOperations).toHaveBeenCalled();

      // Simulate step operation completing (after 1 second)
      setTimeout(() => {
        operationsRunning = false;
      }, 100);

      // Wait for operations to complete and handler to terminate
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should eventually terminate when operations complete
      expect(
        mockExecutionContext.terminationManager.terminate,
      ).toHaveBeenCalledWith({
        reason: TerminationReason.WAIT_SCHEDULED,
        message: "Operation parallel-wait scheduled to wait",
      });
    });
  });
});
