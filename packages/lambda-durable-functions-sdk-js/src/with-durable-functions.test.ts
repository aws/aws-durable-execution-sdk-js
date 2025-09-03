import { withDurableFunctions } from "./with-durable-functions";
import { initializeExecutionContext } from "./context/execution-context/execution-context";
import { createDurableContext } from "./context/durable-context/durable-context";
import { CheckpointFailedError } from "./errors/checkpoint-errors/checkpoint-errors";
import { TerminationReason } from "./termination-manager/types";
import { Context } from "aws-lambda";
import { log } from "./utils/logger/logger";
import { DurableExecutionInvocationInput, InvocationStatus } from "./types";
import {
  createCheckpoint,
  deleteCheckpoint,
} from "./utils/checkpoint/checkpoint";
import { TEST_CONSTANTS } from "./testing/test-constants";
import { createErrorObjectFromError } from "./utils/error-object/error-object";

// Mock dependencies
jest.mock("./context/execution-context/execution-context");
jest.mock("./context/durable-context/durable-context");
jest.mock("./utils/checkpoint/checkpoint");
jest.mock("./utils/logger/logger", () => ({
  log: jest.fn(),
}));

const mockCheckpointToken = "test-checkpoint-token";
const mockDurableExecutionArn = "test-durable-execution-arn";

describe("withDurableFunctions", () => {
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
  };

  const mockCustomerHandlerEvent = "{}";
  const mockExecutionContext = {
    customerHandlerEvent: mockCustomerHandlerEvent,
    state: {},
    _stepData: {},
    terminationManager: mockTerminationManager,
    mutex: { lock: jest.fn((fn) => fn()) },
    isLocalMode: false,
    isVerbose: false,
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
    const wrappedHandler = withDurableFunctions(mockHandler);
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
    const wrappedHandler = withDurableFunctions(mockHandler);
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

  it("should throw error when handler throws CheckpointFailedError", async () => {
    // Setup
    const checkpointError = new CheckpointFailedError("Checkpoint failed test");
    const mockHandler = jest.fn().mockRejectedValue(checkpointError);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    ); // Never resolves

    // Execute & Verify
    const wrappedHandler = withDurableFunctions(mockHandler);
    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      CheckpointFailedError,
    );
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
  });

  it("should throw error when termination promise resolves with CHECKPOINT_FAILED reason", async () => {
    // Setup
    const mockHandler = jest.fn().mockReturnValue(new Promise(() => {})); // Never resolves
    mockTerminationManager.getTerminationPromise.mockResolvedValue({
      reason: TerminationReason.CHECKPOINT_FAILED,
      message: "Checkpoint failed via termination",
    });

    // Execute & Verify
    const wrappedHandler = withDurableFunctions(mockHandler);
    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      CheckpointFailedError,
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
    const wrappedHandler = withDurableFunctions(mockHandler);
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
    const wrappedHandler = withDurableFunctions(mockHandler);
    await wrappedHandler(mockEvent, mockContext);

    // Verify setTimeout was called
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);

    // Verify log was called with the right parameters
    expect(log).toHaveBeenCalledWith(
      true,
      "⏱️",
      "Promise race status check:",
      expect.objectContaining({
        handlerResolved: false,
        terminationResolved: false,
      }),
    );

    // Clean up
    setTimeoutSpy.mockRestore();
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
    const wrappedHandler = withDurableFunctions(mockHandler);
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
    const wrappedHandler = withDurableFunctions(mockHandler);
    const response = await wrappedHandler(mockEvent, mockContext);

    // Verify - should use fallback "undefined" string
    expect(response).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: "",
    });
  });

  it("should checkpoint large results that exceed Lambda response size limit", async () => {
    // Setup - Create a large result that exceeds 6MB
    const largeResult = { data: "x".repeat(6 * 1024 * 1024) }; // 6MB of data
    const mockHandler = jest.fn().mockResolvedValue(largeResult);
    const mockCheckpoint = jest.fn().mockResolvedValue(undefined);

    (createCheckpoint as jest.Mock).mockReturnValue(mockCheckpoint);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    );

    // Execute
    const wrappedHandler = withDurableFunctions(mockHandler);
    const response = await wrappedHandler(mockEvent, mockContext);

    // Verify
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
    expect(createCheckpoint).toHaveBeenCalledWith(
      mockExecutionContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );
    expect(mockCheckpoint).toHaveBeenCalledWith(
      expect.stringMatching(/^execution-result-\d+$/),
      expect.objectContaining({
        Id: expect.stringMatching(/^execution-result-\d+$/),
        Action: "SUCCEED",
        Type: "EXECUTION",
        Payload: JSON.stringify(largeResult),
      }),
    );
    expect(response).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: "",
    });
  });

  it("should throw CheckpointFailedError when large result checkpointing fails", async () => {
    // Setup - Create a large result that exceeds 6MB
    const largeResult = { data: "x".repeat(6 * 1024 * 1024) }; // 6MB of data
    const mockHandler = jest.fn().mockResolvedValue(largeResult);
    const checkpointError = new Error("Checkpoint service unavailable");
    const mockCheckpoint = jest.fn().mockRejectedValue(checkpointError);

    (createCheckpoint as jest.Mock).mockReturnValue(mockCheckpoint);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    );

    // Execute & Verify
    const wrappedHandler = withDurableFunctions(mockHandler);
    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      CheckpointFailedError,
    );
    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      "Failed to checkpoint large result: Checkpoint service unavailable",
    );

    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
    expect(createCheckpoint).toHaveBeenCalledWith(
      mockExecutionContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );
    expect(mockCheckpoint).toHaveBeenCalledWith(
      expect.stringMatching(/^execution-result-\d+$/),
      expect.objectContaining({
        Action: "SUCCEED",
        Type: "EXECUTION",
        Payload: JSON.stringify(largeResult),
      }),
    );
  });

  it("should throw CheckpointFailedError with generic message when large result checkpointing fails with non-Error", async () => {
    // Setup - Create a large result that exceeds 6MB
    const largeResult = { data: "x".repeat(6 * 1024 * 1024) }; // 6MB of data
    const mockHandler = jest.fn().mockResolvedValue(largeResult);
    const mockCheckpoint = jest.fn().mockRejectedValue("string error"); // Non-Error object

    (createCheckpoint as jest.Mock).mockReturnValue(mockCheckpoint);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    );

    // Execute & Verify
    const wrappedHandler = withDurableFunctions(mockHandler);
    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      CheckpointFailedError,
    );
    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      "Failed to checkpoint large result: Unknown error",
    );

    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
    expect(createCheckpoint).toHaveBeenCalledWith(
      mockExecutionContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );
  });

  it("should call deleteCheckpoint when initializing durable function", async () => {
    // Setup
    const mockResult = { success: true };
    const mockHandler = jest.fn().mockResolvedValue(mockResult);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    ); // Never resolves

    // Execute
    const wrappedHandler = withDurableFunctions(mockHandler);
    const response = await wrappedHandler(mockEvent, mockContext);
    expect(deleteCheckpoint).toHaveBeenCalledTimes(1);

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
});
