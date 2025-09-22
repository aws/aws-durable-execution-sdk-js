import {
  createMockCheckpoint,
  CheckpointFunction,
} from "../../testing/mock-checkpoint";
import { createStepHandler } from "./step-handler";
import { ExecutionContext, StepSemantics, OperationSubType } from "../../types";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import { retryPresets } from "../../utils/retry/retry-presets/retry-presets";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { StepInterruptedError } from "../../errors/step-errors/step-errors";
import { TerminationReason } from "../../termination-manager/types";
import {
  UnrecoverableError,
  UnrecoverableExecutionError,
  UnrecoverableInvocationError,
} from "../../errors/unrecoverable-error/unrecoverable-error";
import {
  OperationType,
  OperationStatus,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { OperationInterceptor } from "../../mocks/operation-interceptor";
import { hashId, getStepData } from "../../utils/step-id-utils/step-id-utils";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";

jest.mock("../../utils/retry/retry-presets/retry-presets", () => ({
  retryPresets: {
    default: jest.fn(),
  },
}));

describe("Step Handler", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockCheckpoint: jest.MockedFunction<CheckpointFunction>;
  let mockParentContext: any;
  let createStepId: jest.Mock;
  let stepHandler: ReturnType<typeof createStepHandler>;
  let mockTerminationManager: jest.Mocked<TerminationManager>;

  beforeEach(() => {
    // Reset all mocks before each test to ensure isolation
    jest.resetAllMocks();

    // Create a mock termination manager
    mockTerminationManager = {
      terminate: jest.fn(),
      getTerminationPromise: jest.fn(),
    } as unknown as jest.Mocked<TerminationManager>;

    mockExecutionContext = {
      state: {
        getStepData: jest.fn(),
        checkpoint: jest.fn(),
      },
      _stepData: {},
      terminationManager: mockTerminationManager,
      mutex: {
        lock: jest.fn((fn) => fn()),
      },
      isLocalMode: false,
      isVerbose: false,
      getStepData: jest.fn((stepId: string) => {
        return getStepData(mockExecutionContext._stepData, stepId);
      }),
    } as unknown as jest.Mocked<ExecutionContext>;

    mockCheckpoint = createMockCheckpoint();
    mockParentContext = { awsRequestId: "mock-request-id" };
    createStepId = jest.fn().mockReturnValue("test-step-id");

    const mockLogger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
    const createMockEnrichedLogger = () => mockLogger;

    stepHandler = createStepHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createMockEnrichedLogger,
      jest.fn(), // addRunningOperation
      jest.fn(), // removeRunningOperation
      jest.fn(() => false), // hasRunningOperations
    );

    // Reset the mock for retryPresets.default
    (retryPresets.default as jest.Mock).mockReset();
  });

  test("should execute step function with StepContext", async () => {
    const stepFn = jest.fn().mockResolvedValue("step-result");

    const result = await stepHandler("test-step", stepFn);

    expect(result).toBe("step-result");
    expect(stepFn).toHaveBeenCalledTimes(1);
    // Verify that StepContext was passed to the step function
    expect(stepFn.mock.calls[0].length).toBe(1);
    expect(stepFn.mock.calls[0][0]).toHaveProperty("logger");
  });

  test("should checkpoint at start and finish with AT_MOST_ONCE_PER_RETRY semantics", async () => {
    const stepFn = jest.fn().mockResolvedValue("step-result");

    await stepHandler("test-step", stepFn, {
      semantics: StepSemantics.AtMostOncePerRetry,
    });

    expect(mockCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      1,
      "test-step-id",
      TEST_CONSTANTS.DEFAULT_STEP_START_CHECKPOINT,
    );
    expect(mockCheckpoint).toHaveBeenNthCalledWith(2, "test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_SUCCEED_CHECKPOINT,
      Payload: JSON.stringify("step-result"),
    });
  });

  test("should checkpoint at start and finish with AT_LEAST_ONCE_PER_RETRY semantics (default)", async () => {
    const stepFn = jest.fn().mockResolvedValue("step-result");

    await stepHandler("test-step", stepFn);

    expect(mockCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockCheckpoint).toHaveBeenNthCalledWith(1, "test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_START_CHECKPOINT,
    });
    expect(mockCheckpoint).toHaveBeenNthCalledWith(2, "test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_SUCCEED_CHECKPOINT,
      Payload: JSON.stringify("step-result"),
    });
  });

  test("should not await START checkpoint for AT_LEAST_ONCE_PER_RETRY semantics", async () => {
    let checkpointResolve: () => void;
    const checkpointPromise = new Promise<void>((resolve) => {
      checkpointResolve = resolve;
    });

    // Mock checkpoint to return a promise that we control
    mockCheckpoint.mockImplementation(() => checkpointPromise);

    const stepFn = jest.fn().mockResolvedValue("step-result");

    // Start the step execution (should not hang waiting for START checkpoint)
    const stepPromise = stepHandler("test-step", stepFn);

    // Give a small delay to ensure the step function would be called if not waiting
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Step function should have been called even though checkpoint promise hasn't resolved
    expect(stepFn).toHaveBeenCalled();

    // Now resolve the checkpoint promise to complete the test
    checkpointResolve!();
    await stepPromise;

    expect(mockCheckpoint).toHaveBeenCalledTimes(2); // START + SUCCEED
  });

  test("should handle interrupted step with AT_MOST_ONCE_PER_RETRY semantics", async () => {
    // Set up a step that was started but not completed
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);
    const stepData = mockExecutionContext._stepData as any;
    stepData[hashedStepId] = {
      Id: hashedStepId,
      Status: OperationStatus.STARTED,
      StepDetails: {
        Attempt: 0,
      },
    };

    const stepFn = jest.fn().mockResolvedValue("step-result");
    const mockRetryStrategy = jest
      .fn()
      .mockReturnValue({ shouldRetry: true, delaySeconds: 10 });

    // Call the step handler with AT_MOST_ONCE_PER_RETRY semantics
    const stepPromise = stepHandler("test-step", stepFn, {
      semantics: StepSemantics.AtMostOncePerRetry,
      retryStrategy: mockRetryStrategy,
    });

    // Wait a small amount of time for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the step function was not called
    expect(stepFn).not.toHaveBeenCalled();

    // Verify the retry strategy was called with a StepInterruptedError
    expect(mockRetryStrategy).toHaveBeenCalledTimes(1);
    const [error, attemptCount] = mockRetryStrategy.mock.calls[0];
    expect(error).toBeInstanceOf(StepInterruptedError);
    expect(error.message).toBe(
      "The step execution process was initiated but failed to reach completion due to an interruption.",
    );
    expect(attemptCount).toBe(1);

    // Verify the checkpoint was called with retry status
    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_RETRY_CHECKPOINT,
      Error: expect.objectContaining({
        ErrorMessage:
          "The step execution process was initiated but failed to reach completion due to an interruption.",
        ErrorType: "StepInterruptedError",
        StackTrace: expect.any(Array),
      }),
      StepOptions: {
        NextAttemptDelaySeconds: 10,
      },
    });

    // Verify terminate was called
    expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.RETRY_SCHEDULED,
      message: expect.stringContaining("test-step"),
    });
  }, 10000);

  test("should not retry interrupted step when retry strategy returns shouldRetry: false", async () => {
    // Set up a step that was started but not completed
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);
    mockExecutionContext._stepData = {
      [hashedStepId]: {
        Id: hashedStepId,
        Status: OperationStatus.STARTED,
        StepDetails: {
          Attempt: 0,
        },
      },
    } as any;

    const stepFn = jest.fn().mockResolvedValue("step-result");
    const mockRetryStrategy = jest.fn().mockReturnValue({ shouldRetry: false });

    // Call the step handler with AT_MOST_ONCE_PER_RETRY semantics
    await expect(
      stepHandler("test-step", stepFn, {
        semantics: StepSemantics.AtMostOncePerRetry,
        retryStrategy: mockRetryStrategy,
      }),
    ).rejects.toThrow(StepInterruptedError);

    // Verify the step function was not called
    expect(stepFn).not.toHaveBeenCalled();

    // Verify the retry strategy was called with a StepInterruptedError
    expect(mockRetryStrategy).toHaveBeenCalledTimes(1);
    const [error, attemptCount] = mockRetryStrategy.mock.calls[0];
    expect(error).toBeInstanceOf(StepInterruptedError);
    expect(error.message).toBe(
      "The step execution process was initiated but failed to reach completion due to an interruption.",
    );
    expect(attemptCount).toBe(1);

    // Verify the checkpoint was called with failed status
    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_FAIL_CHECKPOINT,
      Error: expect.objectContaining({
        ErrorMessage:
          "The step execution process was initiated but failed to reach completion due to an interruption.",
        ErrorType: "StepInterruptedError",
        StackTrace: expect.any(Array),
      }),
    });
  });

  test("should ignore interrupted step with AT_LEAST_ONCE_PER_RETRY semantics", async () => {
    // Set up a step that was started but not completed
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);
    mockExecutionContext._stepData = {
      [hashedStepId]: {
        Id: hashedStepId,
        Status: OperationStatus.STARTED,
        StepDetails: {},
      },
    } as any;

    const stepFn = jest.fn().mockResolvedValue("step-result");

    // Call the step handler with AT_LEAST_ONCE_PER_RETRY semantics (default)
    await stepHandler("test-step", stepFn);

    // Verify the step function was called (re-executed)
    expect(stepFn).toHaveBeenCalledTimes(1);

    // Verify the checkpoint was called with completed status
    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_SUCCEED_CHECKPOINT,
      Payload: JSON.stringify("step-result"),
    });
  });

  test("should return cached result for completed step", async () => {
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);
    mockExecutionContext._stepData = {
      [hashedStepId]: {
        Id: hashedStepId,
        Status: OperationStatus.SUCCEEDED,
        StepDetails: {
          Result: JSON.stringify("cached-result"),
        },
      },
    } as any;

    const stepFn = jest.fn().mockResolvedValue("new-result");

    const result = await stepHandler("test-step", stepFn);

    expect(result).toBe("cached-result");
    expect(stepFn).not.toHaveBeenCalled();
  });

  test("should throw error for failed step", async () => {
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);
    mockExecutionContext._stepData = {
      [hashedStepId]: {
        Id: hashedStepId,
        Status: OperationStatus.FAILED,
        StepDetails: {
          Result: "previous-error",
        },
      },
    } as any;

    const stepFn = jest.fn();

    await expect(stepHandler("test-step", stepFn)).rejects.toThrow(
      "previous-error",
    );
    expect(stepFn).not.toHaveBeenCalled();
  });

  test("should use custom retry strategy when provided", async () => {
    const error = new Error("step-error");
    const stepFn = jest.fn().mockRejectedValue(error);
    const mockRetryStrategy = jest
      .fn()
      .mockReturnValue({ shouldRetry: true, delaySeconds: 10 });

    // Call the step handler but don't await it (it will never resolve)
    const stepPromise = stepHandler("test-step", stepFn, {
      retryStrategy: mockRetryStrategy,
    });

    // Wait a small amount of time for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the retry strategy was called
    expect(mockRetryStrategy).toHaveBeenCalledWith(error, 1);

    // Verify the checkpoint was called with retry status
    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_RETRY_CHECKPOINT,
      Error: createErrorObjectFromError(error),
      StepOptions: {
        NextAttemptDelaySeconds: 10,
      },
    });

    // Verify terminate was called
    expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.RETRY_SCHEDULED,
      message: "Retry scheduled for test-step",
    });
  }, 10000);

  test("should use default retry strategy when not provided", async () => {
    const error = new Error("step-error");
    const stepFn = jest.fn().mockRejectedValue(error);

    (retryPresets.default as jest.Mock).mockReturnValue({
      shouldRetry: true,
      delaySeconds: 5,
    });

    // Call the step handler but don't await it (it will never resolve)
    const stepPromise = stepHandler("test-step", stepFn);

    // Wait a small amount of time for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the default retry strategy was called
    expect(retryPresets.default).toHaveBeenCalledWith(error, 1);

    // Verify the checkpoint was called with retry status
    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_RETRY_CHECKPOINT,
      Error: createErrorObjectFromError(error),
      StepOptions: {
        NextAttemptDelaySeconds: 5,
      },
    });

    // Verify terminate was called
    expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.RETRY_SCHEDULED,
      message: "Retry scheduled for test-step",
    });
  }, 10000);

  test("should handle non-Error objects thrown by step function", async () => {
    const nonErrorObject = "string error";
    const stepFn = jest.fn().mockRejectedValue(nonErrorObject);

    (retryPresets.default as jest.Mock).mockReturnValue({ shouldRetry: false });

    await expect(stepHandler("test-step", stepFn)).rejects.toBe(nonErrorObject);

    // Verify the default retry strategy was called with an Error wrapper
    expect(retryPresets.default).toHaveBeenCalledTimes(1);
    const [error, attemptCount] = (retryPresets.default as jest.Mock).mock
      .calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Unknown Error");

    // Verify the checkpoint was called with failed status
    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_FAIL_CHECKPOINT,
      Error: createErrorObjectFromError("Unknown error"),
    });
  });

  test("should checkpoint failure when retry is not needed", async () => {
    const error = new Error("step-error");
    const stepFn = jest.fn().mockRejectedValue(error);
    const mockRetryStrategy = jest.fn().mockReturnValue({ shouldRetry: false });

    await expect(
      stepHandler("test-step", stepFn, { retryStrategy: mockRetryStrategy }),
    ).rejects.toThrow("step-error");

    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_FAIL_CHECKPOINT,
      Error: createErrorObjectFromError(error),
    });
  });

  test("should support unnamed steps", async () => {
    const stepFn = jest.fn().mockResolvedValue("step-result");

    await stepHandler(stepFn);

    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_SUCCEED_CHECKPOINT,
      Payload: JSON.stringify("step-result"),
      Name: undefined,
    });
  });

  test("should accept undefined as name parameter", async () => {
    const stepFn = jest.fn().mockResolvedValue("step-result");

    await stepHandler(undefined, stepFn);

    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_SUCCEED_CHECKPOINT,
      Payload: JSON.stringify("step-result"),
      Name: undefined,
    });
  });

  test("should return undefined when completed step has no result", async () => {
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);
    mockExecutionContext._stepData = {
      [hashedStepId]: {
        Id: hashedStepId,
        Status: OperationStatus.SUCCEEDED,
        StepDetails: {}, // No result provided
      },
    } as any;

    const stepFn = jest.fn().mockResolvedValue("step-result");

    await expect(stepHandler("test-step", stepFn)).resolves.toBe(undefined);
    expect(stepFn).not.toHaveBeenCalled();
  });

  test("should return undefined result when completed step has undefined result value", async () => {
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);
    mockExecutionContext._stepData = {
      [hashedStepId]: {
        Id: hashedStepId,
        Status: OperationStatus.SUCCEEDED,
        StepDetails: {
          Result: undefined,
        },
      },
    } as any;

    const stepFn = jest.fn().mockResolvedValue("step-result");

    await expect(stepHandler("test-step", stepFn)).resolves.toBe(undefined);
    expect(stepFn).not.toHaveBeenCalled();
  });

  test("should handle interrupted step with AT_MOST_ONCE_PER_RETRY semantics and default retry strategy", async () => {
    // Set up a step that was started but not completed
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);
    mockExecutionContext._stepData = {
      [hashedStepId]: {
        Id: hashedStepId,
        Status: OperationStatus.STARTED,
        StepDetails: {
          Attempt: 0,
        },
      },
    } as any;

    const stepFn = jest.fn().mockResolvedValue("step-result");

    // Mock the default retry strategy
    (retryPresets.default as jest.Mock).mockReturnValue({
      shouldRetry: true,
      delaySeconds: 5,
    });

    // Call the step handler with AT_MOST_ONCE_PER_RETRY semantics but no custom retry strategy
    const stepPromise = stepHandler("test-step", stepFn, {
      semantics: StepSemantics.AtMostOncePerRetry,
    });

    // Wait a small amount of time for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the step function was not called
    expect(stepFn).not.toHaveBeenCalled();

    // Verify the default retry strategy was called with a StepInterruptedError
    expect(retryPresets.default).toHaveBeenCalledTimes(1);
    const [error, attemptCount] = (retryPresets.default as jest.Mock).mock
      .calls[0];
    expect(error).toBeInstanceOf(StepInterruptedError);
    expect(error.message).toBe(
      "The step execution process was initiated but failed to reach completion due to an interruption.",
    );
    expect(attemptCount).toBe(1);

    // Verify the checkpoint was called with retry status
    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_RETRY_CHECKPOINT,
      Error: expect.objectContaining({
        ErrorMessage:
          "The step execution process was initiated but failed to reach completion due to an interruption.",
        ErrorType: "StepInterruptedError",
        StackTrace: expect.any(Array),
      }),
      StepOptions: {
        NextAttemptDelaySeconds: 5,
      },
    });

    // Verify terminate was called
    expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.RETRY_SCHEDULED,
      message: expect.stringContaining("test-step"),
    });
  }, 10000);

  test("should throw unknown error when failed step has no error message", async () => {
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);
    mockExecutionContext._stepData = {
      [hashedStepId]: {
        Id: hashedStepId,
        Status: OperationStatus.FAILED,
        StepDetails: {
          Result: "", // Empty error message
        },
      },
    } as any;

    const stepFn = jest.fn();

    await expect(stepHandler("test-step", stepFn)).rejects.toThrow(
      "Unknown error",
    );
    expect(stepFn).not.toHaveBeenCalled();
  });

  test("should throw unknown error when failed step has no error details", async () => {
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);
    mockExecutionContext._stepData = {
      [hashedStepId]: {
        Id: hashedStepId,
        Status: OperationStatus.FAILED,
        StepDetails: {}, // No result provided
      },
    } as any;

    const stepFn = jest.fn();

    await expect(stepHandler("test-step", stepFn)).rejects.toThrow(
      "Unknown error",
    );
    expect(stepFn).not.toHaveBeenCalled();
  });

  test("should use stepId as message when name is not provided for retry scheduled", async () => {
    const error = new Error("step-error");
    const stepFn = jest.fn().mockRejectedValue(error);

    (retryPresets.default as jest.Mock).mockReturnValue({
      shouldRetry: true,
      delaySeconds: 5,
    });

    // Call the step handler without a name
    const stepPromise = stepHandler(stepFn);

    // Wait a small amount of time for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify terminate was called with stepId in the message
    expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.RETRY_SCHEDULED,
      message: "Retry scheduled for test-step-id",
    });
  });

  test("should use stepId as message when name is not provided for retry interrupted step", async () => {
    // Set up a step that was started but not completed
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);
    mockExecutionContext._stepData = {
      [hashedStepId]: {
        Id: hashedStepId,
        Status: OperationStatus.STARTED,
        StepDetails: {
          Attempt: 0,
        },
      },
    } as any;

    const stepFn = jest.fn().mockResolvedValue("step-result");

    // Mock the default retry strategy
    (retryPresets.default as jest.Mock).mockReturnValue({
      shouldRetry: true,
      delaySeconds: 5,
    });

    // Call the step handler with AT_MOST_ONCE_PER_RETRY semantics but no name
    const stepPromise = stepHandler(stepFn, {
      semantics: StepSemantics.AtMostOncePerRetry,
    });

    // Wait a small amount of time for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify terminate was called with stepId in the message
    expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.RETRY_SCHEDULED,
      message: "Retry scheduled for test-step-id",
    });
  });

  test("should wait for timer when status is PENDING", async () => {
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);
    mockExecutionContext._stepData = {
      [hashedStepId]: {
        Id: hashedStepId,
        Status: OperationStatus.PENDING,
      },
    };

    const stepFunction = jest.fn().mockResolvedValue("result");

    const promise = stepHandler(stepId, stepFunction);

    // Should terminate with retry scheduled message
    expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.RETRY_SCHEDULED,
      message: "Retry scheduled for test-step-id",
    });

    // Should return never-resolving promise
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(resolved).toBe(false);
  });

  test("should handle missing attemptCount for interrupted step", async () => {
    // Set up a step that was started but not completed and has no attempt
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);
    mockExecutionContext._stepData = {
      [hashedStepId]: {
        Id: hashedStepId,
        Status: OperationStatus.STARTED,
        StepDetails: {}, // No attempt provided
      },
    } as any;

    const stepFn = jest.fn().mockResolvedValue("step-result");
    const mockRetryStrategy = jest
      .fn()
      .mockReturnValue({ shouldRetry: true, delaySeconds: 10 });

    // Call the step handler with AT_MOST_ONCE_PER_RETRY semantics
    const stepPromise = stepHandler("test-step", stepFn, {
      semantics: StepSemantics.AtMostOncePerRetry,
      retryStrategy: mockRetryStrategy,
    });

    // Wait a small amount of time for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the retry strategy was called with attempt count 1 (default)
    expect(mockRetryStrategy).toHaveBeenCalledTimes(1);
    const [error, attemptCount] = mockRetryStrategy.mock.calls[0];
    expect(attemptCount).toBe(1);
  });

  test("should handle non-Error objects in retry strategy with custom retry strategy", async () => {
    const nonErrorObject = { custom: "error object" };
    const stepFn = jest.fn().mockRejectedValue(nonErrorObject);
    const mockRetryStrategy = jest
      .fn()
      .mockReturnValue({ shouldRetry: true, delaySeconds: 10 });

    // Call the step handler with custom retry strategy
    const stepPromise = stepHandler("test-step", stepFn, {
      retryStrategy: mockRetryStrategy,
    });

    // Wait a small amount of time for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the retry strategy was called with an Error wrapper
    expect(mockRetryStrategy).toHaveBeenCalledTimes(1);
    const [error, attemptCount] = mockRetryStrategy.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Unknown Error");

    // Verify the checkpoint was called with retry status and Unknown error
    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_RETRY_CHECKPOINT,
      Error: createErrorObjectFromError("Unknown error"),
      StepOptions: {
        NextAttemptDelaySeconds: 10,
      },
    });
  });

  test("should handle non-Error objects in retry strategy with default retry strategy", async () => {
    const nonErrorObject = { custom: "error object" };
    const stepFn = jest.fn().mockRejectedValue(nonErrorObject);

    (retryPresets.default as jest.Mock).mockReturnValue({
      shouldRetry: true,
      delaySeconds: 5,
    });

    // Call the step handler with default retry strategy
    const stepPromise = stepHandler("test-step", stepFn);

    // Wait a small amount of time for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the default retry strategy was called with an Error wrapper
    expect(retryPresets.default).toHaveBeenCalledTimes(1);
    const [error, attemptCount] = (retryPresets.default as jest.Mock).mock
      .calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Unknown Error");

    // Verify the checkpoint was called with retry status and Unknown error
    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      ...TEST_CONSTANTS.DEFAULT_STEP_RETRY_CHECKPOINT,
      Error: createErrorObjectFromError("Unknown error"),
      StepOptions: {
        NextAttemptDelaySeconds: 5,
      },
    });
  });

  // Test cases for unrecoverable error handling
  describe("Unrecoverable Error Handling", () => {
    // Create a concrete test class for UnrecoverableExecutionError
    class TestUnrecoverableExecutionError extends UnrecoverableExecutionError {
      readonly terminationReason = TerminationReason.CUSTOM;

      constructor(message: string) {
        super(message);
      }
    }

    // Create a concrete test class for UnrecoverableInvocationError
    class TestUnrecoverableInvocationError extends UnrecoverableInvocationError {
      readonly terminationReason = TerminationReason.CUSTOM;

      constructor(message: string) {
        super(message);
      }
    }

    // Create a concrete test class for generic UnrecoverableError
    class TestGenericUnrecoverableError extends UnrecoverableError {
      readonly terminationReason = TerminationReason.CUSTOM;

      constructor(message: string) {
        super(message);
      }
    }

    test("should handle UnrecoverableExecutionError thrown by step function", async () => {
      const unrecoverableError = new TestUnrecoverableExecutionError(
        "Test execution error",
      );
      const stepFn = jest.fn().mockRejectedValue(unrecoverableError);

      // Call the step handler but don't await it (it will never resolve)
      const stepPromise = stepHandler("test-step", stepFn);

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called with execution error details
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          "Unrecoverable error in step test-step: [Unrecoverable Execution] Test execution error",
      });
    }, 10000);

    test("should handle UnrecoverableInvocationError thrown by step function", async () => {
      const unrecoverableError = new TestUnrecoverableInvocationError(
        "Test invocation error",
      );
      const stepFn = jest.fn().mockRejectedValue(unrecoverableError);

      // Call the step handler but don't await it (it will never resolve)
      const stepPromise = stepHandler("test-step", stepFn);

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called with invocation error details
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          "Unrecoverable error in step test-step: [Unrecoverable Invocation] Test invocation error",
      });
    }, 10000);

    test("should handle generic UnrecoverableError thrown by step function", async () => {
      const unrecoverableError = new TestGenericUnrecoverableError(
        "Test generic error",
      );
      const stepFn = jest.fn().mockRejectedValue(unrecoverableError);

      // Call the step handler but don't await it (it will never resolve)
      const stepPromise = stepHandler("test-step", stepFn);

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called with generic error details
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message: "Unrecoverable error in step test-step: Test generic error",
      });
    }, 10000);

    test("should handle UnrecoverableExecutionError with unnamed step", async () => {
      const unrecoverableError = new TestUnrecoverableExecutionError(
        "Test execution error",
      );
      const stepFn = jest.fn().mockRejectedValue(unrecoverableError);

      // Call the step handler but don't await it (it will never resolve)
      const stepPromise = stepHandler(stepFn);

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called with stepId instead of name
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          "Unrecoverable error in step test-step-id: [Unrecoverable Execution] Test execution error",
      });
    }, 10000);

    test("should handle UnrecoverableInvocationError with unnamed step", async () => {
      const unrecoverableError = new TestUnrecoverableInvocationError(
        "Test invocation error",
      );
      const stepFn = jest.fn().mockRejectedValue(unrecoverableError);

      // Call the step handler but don't await it (it will never resolve)
      const stepPromise = stepHandler(stepFn);

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called with stepId instead of name
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          "Unrecoverable error in step test-step-id: [Unrecoverable Invocation] Test invocation error",
      });
    }, 10000);

    test("should handle SerializationFailedError during step execution", async () => {
      const stepFn = jest.fn().mockResolvedValue("result");

      // Mock the serdes to throw a regular error that will be caught by safeSerialize
      const mockSerdes = {
        serialize: jest.fn().mockImplementation(() => {
          throw new Error("Serialization failed");
        }),
        deserialize: jest.fn(),
      };

      // Call the step handler but don't await it (it will never resolve due to termination)
      const stepPromise = stepHandler("test-step", stepFn, {
        serdes: mockSerdes,
      });

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called directly by safeSerialize
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          'Serialization failed for step "test-step" (test-step-id): Serialization failed',
      });
    }, 10000);

    test("should handle DeserializationFailedError during step result deserialization", async () => {
      const stepFn = jest.fn().mockResolvedValue("result");

      // Mock the serdes to throw a regular error that will be caught by safeDeserialize
      const mockSerdes = {
        serialize: jest.fn().mockReturnValue("serialized-result"),
        deserialize: jest.fn().mockImplementation(() => {
          throw new Error("Deserialization failed");
        }),
      };

      // Call the step handler but don't await it (it will never resolve due to termination)
      const stepPromise = stepHandler("test-step", stepFn, {
        serdes: mockSerdes,
      });

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called directly by safeDeserialize
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          'Deserialization failed for step "test-step" (test-step-id): Deserialization failed',
      });
    }, 10000);
  });

  describe("Mock Integration", () => {
    beforeEach(() => {
      // Clear mocks before each test
      OperationInterceptor.clearAll();
      process.env.DURABLE_LOCAL_MODE = "true";
    });

    afterAll(() => {
      process.env.DURABLE_LOCAL_MODE = "false";
    });

    test("should use mock callback when mock is registered", async () => {
      const originalFn = jest.fn().mockResolvedValue("original-result");
      const mockCallback = jest.fn().mockResolvedValue("mocked-result");

      // Register a mock for the step
      OperationInterceptor.forExecution(
        mockExecutionContext.durableExecutionArn,
      )
        .onName("test-step")
        .mock(mockCallback);

      const result = await stepHandler("test-step", originalFn);

      expect(result).toBe("mocked-result");
      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(originalFn).not.toHaveBeenCalled();
    });

    test("should handle index-based mocks for unnamed steps", async () => {
      const originalFn = jest.fn().mockResolvedValue("original-result");
      const mockCallback = jest.fn().mockResolvedValue("mocked-result");

      // Register an index-based mock (first operation = index 0)
      OperationInterceptor.forExecution(
        mockExecutionContext.durableExecutionArn,
      )
        .onIndex(0)
        .mock(mockCallback);

      const result = await stepHandler(originalFn);

      expect(result).toBe("mocked-result");
      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(originalFn).not.toHaveBeenCalled();
    });

    test("should handle sequential mock execution", async () => {
      const originalFn1 = jest.fn().mockResolvedValue("original-1");
      const originalFn2 = jest.fn().mockResolvedValue("original-2");
      const mockCallback1 = jest.fn().mockResolvedValue("mock-1");
      const mockCallback2 = jest.fn().mockResolvedValue("mock-2");

      // Register mocks for sequential steps
      OperationInterceptor.forExecution(
        mockExecutionContext.durableExecutionArn,
      )
        .onName("step-1")
        .mock(mockCallback1);

      OperationInterceptor.forExecution(
        mockExecutionContext.durableExecutionArn,
      )
        .onName("step-2")
        .mock(mockCallback2);

      // Execute first step
      createStepId.mockReturnValueOnce("step-1-id");
      const result1 = await stepHandler("step-1", originalFn1);

      // Execute second step
      createStepId.mockReturnValueOnce("step-2-id");
      const result2 = await stepHandler("step-2", originalFn2);

      expect(result1).toBe("mock-1");
      expect(result2).toBe("mock-2");
      expect(mockCallback1).toHaveBeenCalledTimes(1);
      expect(mockCallback2).toHaveBeenCalledTimes(1);
      expect(originalFn1).not.toHaveBeenCalled();
      expect(originalFn2).not.toHaveBeenCalled();
    });

    test("should handle mock chaining with finite count", async () => {
      const originalFn = jest.fn().mockResolvedValue("original-result");
      const mock1 = jest.fn().mockResolvedValue("mock-1");
      const mock2 = jest.fn().mockResolvedValue("mock-2");

      // Register mocks with finite counts
      OperationInterceptor.forExecution(
        mockExecutionContext.durableExecutionArn,
      )
        .onName("test-step")
        .mock(mock1, 1); // First call only

      OperationInterceptor.forExecution(
        mockExecutionContext.durableExecutionArn,
      )
        .onName("test-step")
        .mock(mock2, 1); // Second call only

      // First call should use mock1
      createStepId.mockReturnValueOnce("step-1-id");
      const result1 = await stepHandler("test-step", originalFn);

      // Second call should use mock2
      createStepId.mockReturnValueOnce("step-2-id");
      const result2 = await stepHandler("test-step", originalFn);

      // Third call should use original function
      createStepId.mockReturnValueOnce("step-3-id");
      const result3 = await stepHandler("test-step", originalFn);

      expect(result1).toBe("mock-1");
      expect(result2).toBe("mock-2");
      expect(result3).toBe("original-result");
      expect(originalFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("ParentId Handling", () => {
    test("should include ParentId in FAIL checkpoint when retry is not needed", async () => {
      mockExecutionContext.parentId = "parent-step-123";

      const error = new Error("step-error");
      const stepFn = jest.fn().mockRejectedValue(error);
      const mockRetryStrategy = jest
        .fn()
        .mockReturnValue({ shouldRetry: false });

      await expect(
        stepHandler("test-step", stepFn, { retryStrategy: mockRetryStrategy }),
      ).rejects.toThrow("step-error");

      expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
        ...TEST_CONSTANTS.DEFAULT_STEP_FAIL_CHECKPOINT,
        ParentId: "parent-step-123",
        Error: createErrorObjectFromError(error),
      });
    });

    test("should include ParentId in RETRY checkpoint when retry is needed", async () => {
      mockExecutionContext.parentId = "parent-step-456";

      const error = new Error("step-error");
      const stepFn = jest.fn().mockRejectedValue(error);
      const mockRetryStrategy = jest
        .fn()
        .mockReturnValue({ shouldRetry: true, delaySeconds: 10 });

      // Call the step handler but don't await it (it will never resolve)
      const stepPromise = stepHandler("test-step", stepFn, {
        retryStrategy: mockRetryStrategy,
      });

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
        ...TEST_CONSTANTS.DEFAULT_STEP_RETRY_CHECKPOINT,
        ParentId: "parent-step-456",
        Error: createErrorObjectFromError(error),
        StepOptions: {
          NextAttemptDelaySeconds: 10,
        },
      });
    });

    test("should include ParentId in START checkpoint for AT_MOST_ONCE_PER_RETRY semantics", async () => {
      mockExecutionContext.parentId = "parent-step-start";

      const stepFn = jest.fn().mockResolvedValue("step-result");

      await stepHandler("test-step", stepFn, {
        semantics: StepSemantics.AtMostOncePerRetry,
      });

      expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
        ...TEST_CONSTANTS.DEFAULT_STEP_START_CHECKPOINT,
        ParentId: "parent-step-start",
      });
    });

    test("should include ParentId in SUCCEED checkpoint for successful step completion", async () => {
      mockExecutionContext.parentId = "parent-step-succeed";

      const stepFn = jest.fn().mockResolvedValue("step-result");

      await stepHandler("test-step", stepFn);

      expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
        ...TEST_CONSTANTS.DEFAULT_STEP_SUCCEED_CHECKPOINT,
        ParentId: "parent-step-succeed",
        Payload: JSON.stringify("step-result"),
      });
    });

    test("should include ParentId in both START and SUCCEED checkpoints for AT_MOST_ONCE_PER_RETRY", async () => {
      mockExecutionContext.parentId = "parent-step-both";

      const stepFn = jest.fn().mockResolvedValue("step-result");

      await stepHandler("test-step", stepFn, {
        semantics: StepSemantics.AtMostOncePerRetry,
      });

      expect(mockCheckpoint).toHaveBeenCalledTimes(2);
      expect(mockCheckpoint).toHaveBeenNthCalledWith(1, "test-step-id", {
        ...TEST_CONSTANTS.DEFAULT_STEP_START_CHECKPOINT,
        ParentId: "parent-step-both",
      });
      expect(mockCheckpoint).toHaveBeenNthCalledWith(2, "test-step-id", {
        ...TEST_CONSTANTS.DEFAULT_STEP_SUCCEED_CHECKPOINT,
        ParentId: "parent-step-both",
        Payload: JSON.stringify("step-result"),
      });
    });
  });
});
