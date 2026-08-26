import { withDurableExecution } from "./with-durable-execution";
import { initializeExecutionContext } from "./context/execution-context/execution-context";
import { createDurableContext } from "./context/durable-context/durable-context";
import { CheckpointUnrecoverableInvocationError } from "./errors/checkpoint-errors/checkpoint-errors";
import { NonDeterministicExecutionError } from "./errors/non-deterministic-error/non-deterministic-error";
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
import { LambdaClient } from "@aws-sdk/client-lambda";
import {
  DurableExecutionClientError,
  DurableExecutionClientErrorScope,
} from "./errors/durable-execution-client-error/durable-execution-client-error";

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
      dispose: jest.fn(),
      waitForQueueCompletion: jest.fn().mockResolvedValue(undefined),
    }));

    // Reset termination manager mock behavior
    mockTerminationManager.getTerminationPromise.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("disposes the checkpoint manager on the normal-completion path", async () => {
    // The path that never terminates, and therefore never reached any cleanup before:
    // without disposal the invocation returns with its poll timers still armed.
    const dispose = jest.fn();
    (CheckpointManager as unknown as jest.Mock).mockImplementation(() => ({
      checkpoint: jest.fn().mockResolvedValue(undefined),
      setTerminating: jest.fn(),
      dispose,
      waitForQueueCompletion: jest.fn().mockResolvedValue(undefined),
    }));
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    );

    await withDurableExecution(jest.fn().mockResolvedValue({ ok: true }))(
      mockEvent,
      mockContext,
    );

    expect(dispose).toHaveBeenCalled();
  });

  it("disposes the checkpoint manager when the handler throws", async () => {
    const dispose = jest.fn();
    (CheckpointManager as unknown as jest.Mock).mockImplementation(() => ({
      checkpoint: jest.fn().mockResolvedValue(undefined),
      setTerminating: jest.fn(),
      dispose,
      waitForQueueCompletion: jest.fn().mockResolvedValue(undefined),
    }));
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    );

    await withDurableExecution(
      jest.fn().mockRejectedValue(new Error("handler blew up")),
    )(mockEvent, mockContext);

    expect(dispose).toHaveBeenCalled();
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

  it("should return FAILED response for CONFIG_VALIDATION_ERROR reason", async () => {
    // Setup: a deterministic, non-retryable caller mistake (e.g. an invalid
    // maxConcurrency) must surface as FAILED, not fall through to the
    // generic PENDING handling used for genuine suspends/pauses.
    const mockHandler = jest.fn().mockReturnValue(new Promise(() => {})); // Never resolves
    const configError = new Error("Invalid maxConcurrency: 0");
    mockTerminationManager.getTerminationPromise.mockResolvedValue({
      reason: TerminationReason.CONFIG_VALIDATION_ERROR,
      message: configError.message,
      error: configError,
    });

    // Execute
    const wrappedHandler = withDurableExecution(mockHandler);
    const response = await wrappedHandler(mockEvent, mockContext);

    // Verify
    expect(response).toEqual({
      Status: InvocationStatus.FAILED,
      Error: expect.objectContaining({
        ErrorMessage: configError.message,
      }),
    });
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
  });

  it("should return FAILED response for CONTEXT_VALIDATION_ERROR reason", async () => {
    // Using a parent or sibling context inside runInChildContext: deterministic and
    // permanent, so the execution fails rather than being reported as still pending.
    const mockHandler = jest.fn().mockReturnValue(new Promise(() => {})); // Never resolves
    const contextError = new Error(
      'Context usage error in "child": You are using a parent or sibling context',
    );
    mockTerminationManager.getTerminationPromise.mockResolvedValue({
      reason: TerminationReason.CONTEXT_VALIDATION_ERROR,
      message: contextError.message,
      error: contextError,
    });

    const response = await withDurableExecution(mockHandler)(
      mockEvent,
      mockContext,
    );

    expect(response).toEqual({
      Status: InvocationStatus.FAILED,
      Error: expect.objectContaining({ ErrorMessage: contextError.message }),
    });
  });

  it("should return FAILED response carrying the error for CUSTOM reason", async () => {
    // CUSTOM is how replay validation reports non-deterministic workflow code. It used
    // to fall through to the generic handling and answer PENDING, which asked the
    // service to retry an error that reproduces on every replay and hid the diagnostic
    // from the customer entirely -- until the execution eventually failed with
    // "Cannot return PENDING status with no pending operations" instead.
    const mockHandler = jest.fn().mockReturnValue(new Promise(() => {})); // Never resolves
    const nonDeterminismError = new NonDeterministicExecutionError(
      'Non-deterministic execution detected: Operation name mismatch for step "1". ' +
        'Expected name "step-a", but got "step-b".',
    );
    mockTerminationManager.getTerminationPromise.mockResolvedValue({
      reason: TerminationReason.CUSTOM,
      message: `Unrecoverable error in step 1: ${nonDeterminismError.message}`,
      error: nonDeterminismError,
    });

    const response = await withDurableExecution(mockHandler)(
      mockEvent,
      mockContext,
    );

    expect(response).toEqual({
      Status: InvocationStatus.FAILED,
      Error: expect.objectContaining({
        ErrorType: "NonDeterministicExecutionError",
        ErrorMessage: nonDeterminismError.message,
      }),
    });
  });

  it("should return FAILED for a termination reason with no explicit branch", async () => {
    // Fail closed: a reason added later without being classified as a suspend must not
    // inherit PENDING by default, because PENDING claims the execution is progressing.
    const mockHandler = jest.fn().mockReturnValue(new Promise(() => {})); // Never resolves
    mockTerminationManager.getTerminationPromise.mockResolvedValue({
      reason: "SOME_FUTURE_REASON" as TerminationReason,
      message: "something the SDK does not classify yet",
    });

    const response = await withDurableExecution(mockHandler)(
      mockEvent,
      mockContext,
    );

    expect(response).toEqual({
      Status: InvocationStatus.FAILED,
      Error: expect.objectContaining({
        ErrorMessage: "something the SDK does not classify yet",
      }),
    });
  });

  it.each([
    TerminationReason.OPERATION_TERMINATED,
    TerminationReason.WAIT_SCHEDULED,
    TerminationReason.RETRY_SCHEDULED,
    TerminationReason.RETRY_INTERRUPTED_STEP,
    TerminationReason.CALLBACK_PENDING,
  ])("should return PENDING response for %s termination", async (reason) => {
    // Setup
    const mockHandler = jest.fn().mockReturnValue(new Promise(() => {})); // Never resolves
    mockTerminationManager.getTerminationPromise.mockResolvedValue({
      reason,
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
      dispose: jest.fn(),
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

  it("should pass client config parameter to initializeExecutionContext", async () => {
    // Setup
    const mockClient = new LambdaClient({});
    const config = { client: mockClient };
    const mockResult = { success: true };
    const mockHandler = jest.fn().mockResolvedValue(mockResult);
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    ); // Never resolves

    // Execute
    const wrappedHandler = withDurableExecution(mockHandler, config);
    await wrappedHandler(mockEvent, mockContext);

    // Verify that the config, carrying the client, reaches initializeExecutionContext
    expect(initializeExecutionContext).toHaveBeenCalledWith(
      mockEvent,
      mockContext,
      config,
    );
    expect(mockHandler).toHaveBeenCalledWith(
      mockCustomerHandlerEvent,
      mockDurableContext,
    );
  });

  it("should return FAILED status when initializeExecutionContext throws a non-retryable KMS error", async () => {
    const kmsError = Object.assign(new Error("KMS access was denied"), {
      name: "KMSAccessDeniedException",
      $metadata: { httpStatusCode: 502 },
    });
    (initializeExecutionContext as jest.Mock).mockRejectedValue(kmsError);

    const mockHandler = jest.fn();
    const wrappedHandler = withDurableExecution(mockHandler);
    const result = await wrappedHandler(mockEvent, mockContext);

    expect(result.Status).toBe(InvocationStatus.FAILED);
    expect(result).toHaveProperty("Error");
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it("should re-throw non-KMS errors from initializeExecutionContext", async () => {
    const serviceError = Object.assign(new Error("Service unavailable"), {
      name: "ServiceException",
      $metadata: { httpStatusCode: 500 },
    });
    (initializeExecutionContext as jest.Mock).mockRejectedValue(serviceError);

    const mockHandler = jest.fn();
    const wrappedHandler = withDurableExecution(mockHandler);

    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      "Service unavailable",
    );
    expect(mockHandler).not.toHaveBeenCalled();
  });

  // Reading execution state happens before the durable machinery is running, so there
  // is no checkpoint classifier to consult. A transport's stated scope has to be
  // honoured here instead.
  it("should return FAILED status when a client states the failure is fatal for the execution", async () => {
    (initializeExecutionContext as jest.Mock).mockRejectedValue(
      new DurableExecutionClientError("execution not found", {
        scope: DurableExecutionClientErrorScope.EXECUTION,
      }),
    );

    const mockHandler = jest.fn();
    const wrappedHandler = withDurableExecution(mockHandler);
    const result = await wrappedHandler(mockEvent, mockContext);

    expect(result.Status).toBe(InvocationStatus.FAILED);
    expect(result).toHaveProperty("Error");
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it("should re-throw when a client states the failure only ends the invocation", async () => {
    (initializeExecutionContext as jest.Mock).mockRejectedValue(
      new DurableExecutionClientError("backend unavailable", {
        scope: DurableExecutionClientErrorScope.INVOCATION,
      }),
    );

    const mockHandler = jest.fn();
    const wrappedHandler = withDurableExecution(mockHandler);

    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      "backend unavailable",
    );
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it("should re-throw an unscoped client error so the execution can resume", async () => {
    (initializeExecutionContext as jest.Mock).mockRejectedValue(
      new DurableExecutionClientError("transient failure"),
    );

    const mockHandler = jest.fn();
    const wrappedHandler = withDurableExecution(mockHandler);

    await expect(wrappedHandler(mockEvent, mockContext)).rejects.toThrow(
      "transient failure",
    );
  });

  it("rejects conflicting transport config before the transport is used", async () => {
    // The point of checking this early: with both provided, the SDK would otherwise pick
    // one, read execution state through it, and only then report the misconfiguration.
    const mockHandler = jest.fn();
    const wrappedHandler = withDurableExecution(mockHandler, {
      client: {} as never,
      durableExecutionClient: {
        getExecutionState: jest.fn(),
        checkpoint: jest.fn(),
      } as never,
    });

    const result = await wrappedHandler(mockEvent, mockContext);

    expect(result.Status).toBe(InvocationStatus.FAILED);
    expect(initializeExecutionContext).not.toHaveBeenCalled();
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it("does not reject either transport option on its own", async () => {
    const mockHandler = jest.fn().mockResolvedValue("ok");
    mockTerminationManager.getTerminationPromise.mockReturnValue(
      new Promise(() => {}),
    );

    await withDurableExecution(mockHandler, {
      durableExecutionClient: {
        getExecutionState: jest.fn(),
        checkpoint: jest.fn(),
      } as never,
    })(mockEvent, mockContext);

    expect(initializeExecutionContext).toHaveBeenCalled();
  });
});
