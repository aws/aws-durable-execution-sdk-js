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
import { hashId, getStepData } from "../../utils/step-id-utils/step-id-utils";
import { EventEmitter } from "events";
import { OPERATIONS_COMPLETE_EVENT } from "../../utils/constants";

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
  let mockOperationsEmitter: EventEmitter;

  beforeEach(() => {
    // Reset all mocks before each test to ensure isolation
    jest.resetAllMocks();

    // Create a mock termination manager
    mockTerminationManager = {
      terminate: jest.fn(),
      getTerminationPromise: jest.fn(),
    } as unknown as jest.Mocked<TerminationManager>;

    mockOperationsEmitter = new EventEmitter();

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
      () => mockOperationsEmitter,
    );
  });

  test("should skip execution if step is already completed", async () => {
    // Set up a step that was already completed
    const stepData = mockExecutionContext._stepData as any;
    stepData[hashId("test-step-id")] = {
      Id: "test-step-id",
      Status: OperationStatus.SUCCEEDED,
    } as Operation;

    await waitHandler("test-wait", { seconds: 1 });

    // Verify checkpoint was not called
    expect(mockCheckpoint).not.toHaveBeenCalled();
    // Verify terminate was not called
    expect(mockTerminationManager.terminate).not.toHaveBeenCalled();
  });

  test("should accept undefined as name parameter", async () => {
    // Call the wait handler with undefined name
    waitHandler({ seconds: 1 });

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
        WaitSeconds: 1,
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
    waitHandler("test-wait", { seconds: 1 });

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
    waitHandler({ seconds: 1 });

    // Wait a small amount of time for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify terminate was called with stepId in the message
    expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.WAIT_SCHEDULED,
      message: "Operation test-step-id scheduled to wait",
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
        () => mockOperationsEmitter,
      );

      waitHandler("test-wait", { seconds: 1 });
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
        WaitDetails: { ScheduledEndTimestamp: new Date(Date.now() + 5000) },
      } as Operation);

      const mockHasRunningOperations = jest.fn(() => false);
      waitHandler = createWaitHandler(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
        () => mockOperationsEmitter,
      );

      waitHandler("test-wait", { seconds: 1 });
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
        () => mockOperationsEmitter,
      );

      waitHandler("test-wait", { seconds: 1 });
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
        WaitDetails: { ScheduledEndTimestamp: new Date(Date.now() + 5000) },
      } as Operation);

      waitHandler = createWaitHandler(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
        () => mockOperationsEmitter,
      );

      // Start the wait handler (don't await - it will wait for operations)
      waitHandler("test-wait", { seconds: 1 });

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
        mockOperationsEmitter.emit(OPERATIONS_COMPLETE_EVENT);
      }, 150);

      // Wait for the event to be processed and terminate
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
        WaitDetails: { ScheduledEndTimestamp: new Date(waitTime) },
      } as Operation);

      waitHandler = createWaitHandler(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
        () => mockOperationsEmitter,
      );

      // Start wait handler - should detect running operations and wait
      waitHandler("parallel-wait", { seconds: 2 });

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
        mockOperationsEmitter.emit(OPERATIONS_COMPLETE_EVENT);
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
