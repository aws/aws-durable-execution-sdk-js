import { withDurableExecution } from "./with-durable-execution";
import { initializeExecutionContext } from "./context/execution-context/execution-context";
import { createDurableContext } from "./context/durable-context/durable-context";
import { CheckpointUnrecoverableInvocationError } from "./errors/checkpoint-errors/checkpoint-errors";
import {
  UnrecoverableInvocationError,
  UnrecoverableExecutionError,
} from "./errors/unrecoverable-error/unrecoverable-error";
import { TerminationReason } from "./termination-manager/types";
import { Context } from "aws-lambda";
import { log } from "./utils/logger/logger";
import { DurableExecutionInvocationInput, InvocationStatus } from "./types";
import { TEST_CONSTANTS } from "./testing/test-constants";
import { createErrorObjectFromError } from "./utils/error-object/error-object";
import { CheckpointManager } from "./utils/checkpoint/checkpoint-manager";

// Mock dependencies
jest.mock("./context/execution-context/execution-context");
jest.mock("./context/durable-context/durable-context");
jest.mock("./utils/checkpoint/checkpoint-manager");
jest.mock("./utils/logger/logger", () => ({
  log: jest.fn(),
}));

const mockCheckpointToken = "test-checkpoint-token";
const mockDurableExecutionArn = "test-durable-execution-arn";

describe("withDurableExecution", () => {
  // Setup common test variables
  const mockEvent: DurableExecutionInvocationInput = {
    CheckpointToken: mockCheckpointToken,
    DurableExecutionArn: mockDurableExecutionArn,
    InitialExecutionState: {
      Operations: [],
      NextMarker: "",
    },
  };

  const mockContext = {} as Context;

  const mockTerminationManager = {
    getTerminationPromise: jest.fn(),
    terminate: jest.fn(),
    setCheckpointTerminatingCallback: jest.fn(),
  };

  const mockCustomerHandlerEvent = {};
  const mockExecutionContext = {
    state: {},
    _stepData: {},
    terminationManager: mockTerminationManager,
    mutex: { lock: jest.fn((fn) => fn()) },
  };

  const mockDurableContext = {
    ...mockContext,
    _stepCounter: 0,
    step: jest.fn(),
    runInChildContext: jest.fn(),
    wait: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Setup default mocks
    (initializeExecutionContext as jest.Mock).mockResolvedValue({
      executionContext: mockExecutionContext,
      checkpointToken: TEST_CONSTANTS.CHECKPOINT_TOKEN,
    });
    (createDurableContext as jest.Mock).mockReturnValue(mockDurableContext);

    // Mock CheckpointManager
    (CheckpointManager as unknown as jest.Mock).mockImplementation(() => ({
      checkpoint: jest.fn().mockResolvedValue(undefined),
      setTerminating: jest.fn(),
      waitForQueueCompletion: jest.fn().mockResolvedValue(undefined),
    }));

    // Reset termination manager mock behavior
    mockTerminationManager.getTerminationPromise.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should return successful response when handler completes normally", async () => {
    // Setup
    const mockResult = { success: true };
    const mockHandler = jest.fn().mockResolvedValue(mockResult);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    ); // Never resolves

    // Execute
    const wrappedHandler = withDurableExecution(mockHandler);
    const response = await wrappedHandler(mockEvent, mockContext);

    // Verify
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
    expect(response).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: JSON.stringify(mockResult),
    });
  });

  it("should return error response when handler throws non-checkpoint error", async () => {
    // Setup
    const testError = new Error("Test error");
    const mockHandler = jest.fn().mockRejectedValue(testError);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    ); // Never resolves

    // Execute
    const wrappedHandler = withDurableExecution(mockHandler);
    const response = await wrappedHandler(mockEvent, mockContext);

    // Verify
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
    expect(response).toEqual({
      Status: InvocationStatus.FAILED,
      Error: createErrorObjectFromError(testError),
    });
  });

  it("should throw error when handler throws CheckpointUnrecoverableInvocationError", async () => {
    // Setup
    const checkpointError = new CheckpointUnrecoverableInvocationError(
      "Checkpoint failed test",
    );
    const mockHandler = jest.fn().mockRejectedValue(checkpointError);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    ); // Never resolves

    // Execute & Verify
    const wrappedHandler = withDurableExecution(mockHandler);
    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      CheckpointUnrecoverableInvocationError,
    );
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
  });

  it("should throw error when termination promise resolves with CHECKPOINT_FAILED reason", async () => {
    // Setup
    const mockHandler = jest.fn().mockReturnValue(new Promise(() => {})); // Never resolves
    const checkpointError = new CheckpointUnrecoverableInvocationError(
      "Checkpoint failed via termination",
    );
    mockTerminationManager.getTerminationPromise.mockResolvedValue({
      reason: TerminationReason.CHECKPOINT_FAILED,
      message: checkpointError.message,
      error: checkpointError,
    });

    // Execute & Verify
    const wrappedHandler = withDurableExecution(mockHandler);
    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      CheckpointUnrecoverableInvocationError,
    );
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
  });

  it("should return PENDING response for non-checkpoint termination", async () => {
    // Setup
    const mockHandler = jest.fn().mockReturnValue(new Promise(() => {})); // Never resolves
    mockTerminationManager.getTerminationPromise.mockResolvedValue({
      reason: TerminationReason.OPERATION_TERMINATED,
      message: "Operation terminated",
    });

    // Execute
    const wrappedHandler = withDurableExecution(mockHandler);
    const response = await wrappedHandler(mockEvent, mockContext);

    // Verify
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
    expect(response).toEqual({
      Status: InvocationStatus.PENDING,
    });
  });

  // Test for the timeout logging branch
  it("should set up timeout for logging promise race status", async () => {
    // Use real timers for this test
    jest.useRealTimers();

    // Setup with verbose mode enabled
    const verboseExecutionContext = {
      ...mockExecutionContext,
      isVerbose: true,
    };
    (initializeExecutionContext as jest.Mock).mockResolvedValue({
      executionContext: verboseExecutionContext,
      checkpointToken: TEST_CONSTANTS.CHECKPOINT_TOKEN,
    });

    const mockResult = { success: true };
    const mockHandler = jest.fn().mockResolvedValue(mockResult);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    );

    // Mock waitForQueueCompletion to resolve immediately
    const waitForQueueCompletionSpy = jest
      .spyOn(CheckpointManager.prototype, "waitForQueueCompletion")
      .mockResolvedValue(undefined);

    // Spy on setTimeout
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");

    // Mock the callback execution to ensure the log function is called
    setTimeoutSpy.mockImplementation((callback, timeout) => {
      expect(timeout).toBe(500);
      // Execute the callback immediately
      callback();
      return 123 as any; // Return a timeout ID
    });

    // Execute
    const wrappedHandler = withDurableExecution(mockHandler);
    await wrappedHandler(mockEvent, mockContext);

    // Verify setTimeout was called with 500ms for logging
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);

    // Verify log was called with the right parameters
    expect(log).toHaveBeenCalledWith(
      "⏱️",
      "Promise race status check:",
      expect.objectContaining({
        handlerResolved: false,
        terminationResolved: false,
      }),
    );

    // Clean up
    setTimeoutSpy.mockRestore();
    waitForQueueCompletionSpy.mockRestore();

    // Restore fake timers for other tests
    jest.useFakeTimers();
  });

  it("should handle non-Error objects thrown by handler", async () => {
    // Setup
    const mockHandler = jest.fn().mockImplementation(() => {
      throw "string error"; // Not an Error object
    });
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    );

    // Execute
    const wrappedHandler = withDurableExecution(mockHandler);
    const response = await wrappedHandler(mockEvent, mockContext);

    // Verify
    expect(response).toEqual({
      Status: InvocationStatus.FAILED,
      Error: createErrorObjectFromError("string error"),
    });
  });

  it("should handle undefined result from handler", async () => {
    // Setup - handler returns undefined
    const mockHandler = jest.fn().mockResolvedValue(undefined);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    );

    // Execute
    const wrappedHandler = withDurableExecution(mockHandler);
    const response = await wrappedHandler(mockEvent, mockContext);

    // Verify - Result should be undefined (not empty string) when handler returns undefined
    // JSON.stringify(undefined) returns undefined, which is preserved in the Result field
    expect(response).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: undefined,
    });
  });

  it("should checkpoint large results that exceed Lambda response size limit", async () => {
    // Setup - Create a large result that exceeds 6MB
    const largeResult = { data: "x".repeat(6 * 1024 * 1024) }; // 6MB of data
    const mockHandler = jest.fn().mockResolvedValue(largeResult);

    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    );

    // Execute
    const wrappedHandler = withDurableExecution(mockHandler);
    const response = await wrappedHandler(mockEvent, mockContext);

    // Verify
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
    expect(response).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: "",
    });
  }, 30000);

  it("should checkpoint large results that exceed Lambda response size limit with large unicode characters", async () => {
    // Setup - Create a large result that exceeds 6MB
    const largeResult = { data: "\u{FFFF}".repeat(2 * 1024 * 1024) }; // 6MB of byte length, but only 2MB in length
    const mockHandler = jest.fn().mockResolvedValue(largeResult);

    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    );

    // Execute
    const wrappedHandler = withDurableExecution(mockHandler);
    const response = await wrappedHandler(mockEvent, mockContext);

    // Verify
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
    expect(response).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: "",
    });
  }, 30000);

  it("should throw SerdesFailedError when termination reason is SERDES_FAILED", async () => {
    // Setup - handler never resolves so termination wins the race
    const mockHandler = jest.fn().mockReturnValue(new Promise(() => {})); // Never resolves
    mockTerminationManager.getTerminationPromise.mockResolvedValue({
      reason: TerminationReason.SERDES_FAILED,
      message: "Serialization failed for step test-step",
    });

    // Execute & Verify
    const wrappedHandler = withDurableExecution(mockHandler);
    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      "Serialization failed for step test-step",
    );
  });

  it("should throw checkpoint error when large result checkpointing fails", async () => {
    // Setup - Create a large result that exceeds 6MB
    const largeResult = { data: "x".repeat(6 * 1024 * 1024) };
    const mockHandler = jest.fn().mockResolvedValue(largeResult);
    const checkpointError = new CheckpointUnrecoverableInvocationError(
      "Checkpoint service unavailable",
    );

    // Mock CheckpointManager to fail on checkpoint
    (CheckpointManager as unknown as jest.Mock).mockImplementation(() => ({
      checkpoint: jest.fn().mockRejectedValue(checkpointError),
      setTerminating: jest.fn(),
    }));

    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    );

    // Execute & Verify
    const wrappedHandler = withDurableExecution(mockHandler);
    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      CheckpointUnrecoverableInvocationError,
    );
  }, 30000);

  it("should throw error when handler throws UnrecoverableInvocationError", async () => {
    // Setup - Create a test UnrecoverableInvocationError
    class TestInvocationError extends UnrecoverableInvocationError {
      readonly terminationReason = TerminationReason.CUSTOM;
      constructor(message: string) {
        super(message);
      }
    }

    const testError = new TestInvocationError("Test invocation error");
    const mockHandler = jest.fn().mockRejectedValue(testError);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    ); // Never resolves

    // Execute & Verify
    const wrappedHandler = withDurableExecution(mockHandler);
    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      TestInvocationError,
    );
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
  });

  it("should throw error when handler throws custom UnrecoverableInvocationError", async () => {
    // Setup - Create a custom UnrecoverableInvocationError
    class CustomInvocationError extends UnrecoverableInvocationError {
      readonly terminationReason = TerminationReason.CUSTOM;
      constructor(message: string) {
        super(message);
      }
    }

    const customError = new CustomInvocationError("Custom invocation error");
    const mockHandler = jest.fn().mockRejectedValue(customError);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    ); // Never resolves

    // Execute & Verify
    const wrappedHandler = withDurableExecution(mockHandler);
    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      CustomInvocationError,
    );
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
  });

  it("should return error response when handler throws UnrecoverableExecutionError", async () => {
    // Setup - Create a custom UnrecoverableExecutionError
    class CustomExecutionError extends UnrecoverableExecutionError {
      readonly terminationReason = TerminationReason.CUSTOM;
      constructor(message: string) {
        super(message);
      }
    }

    const executionError = new CustomExecutionError("Custom execution error");
    const mockHandler = jest.fn().mockRejectedValue(executionError);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    ); // Never resolves

    // Execute
    const wrappedHandler = withDurableExecution(mockHandler);
    const response = await wrappedHandler(mockEvent, mockContext);

    // Verify - UnrecoverableExecutionError should be returned as failed invocation, not thrown
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
    expect(response).toEqual({
      Status: InvocationStatus.FAILED,
      Error: createErrorObjectFromError(executionError),
    });
  });

  it("should call deleteCheckpoint when initializing durable function", async () => {
    // Setup
    const mockResult = { success: true };
    const mockHandler = jest.fn().mockResolvedValue(mockResult);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    ); // Never resolves

    // Execute
    const wrappedHandler = withDurableExecution(mockHandler);
    const response = await wrappedHandler(mockEvent, mockContext);

    // With instance-based architecture, deleteCheckpoint is no longer called
    // The test now verifies the handler executes successfully without singleton cleanup

    // Verify
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
    expect(response).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: JSON.stringify(mockResult),
    });
  });

  it("should throw error for invalid durable execution event", async () => {
    const mockHandler = jest.fn();
    const wrappedHandler = withDurableExecution(mockHandler);

    // Test missing DurableExecutionArn
    const invalidEvent1 = { CheckpointToken: "token" };
    await expect(
      wrappedHandler(invalidEvent1 as any, mockContext),
    ).rejects.toThrow(
      "Unexpected payload provided to start the durable execution",
    );

    // Test missing CheckpointToken
    const invalidEvent2 = { DurableExecutionArn: "arn" };
    await expect(
      wrappedHandler(invalidEvent2 as any, mockContext),
    ).rejects.toThrow(
      "Unexpected payload provided to start the durable execution",
    );

    // Test completely invalid event
    const invalidEvent3 = {};
    await expect(
      wrappedHandler(invalidEvent3 as any, mockContext),
    ).rejects.toThrow(
      "Unexpected payload provided to start the durable execution",
    );

    expect(mockHandler).not.toHaveBeenCalled();
  });
});
