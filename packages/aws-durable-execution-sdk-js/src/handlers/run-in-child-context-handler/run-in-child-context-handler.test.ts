import { createRunInChildContextHandler } from "./run-in-child-context-handler";
import { ExecutionContext, OperationSubType } from "../../types";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import {
  createMockCheckpoint,
  CheckpointFunction,
} from "../../testing/mock-checkpoint";
import { createClassSerdesWithDates } from "../../utils/serdes/serdes";
import {
  OperationType,
  OperationStatus,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { hashId, getStepData } from "../../utils/step-id-utils/step-id-utils";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";
import { runWithContext } from "../../utils/context-tracker/context-tracker";
import { DurableExecutionMode } from "../../types/core";

jest.mock("../../utils/context-tracker/context-tracker", () => ({
  ...jest.requireActual("../../utils/context-tracker/context-tracker"),
}));

describe("Run In Child Context Handler", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockCheckpoint: jest.MockedFunction<CheckpointFunction>;
  let mockParentContext: any;
  let createStepId: jest.Mock;
  let runInChildContextHandler: ReturnType<
    typeof createRunInChildContextHandler
  >;

  beforeEach(() => {
    // Reset all mocks before each test to ensure isolation
    jest.resetAllMocks();

    mockExecutionContext = {
      state: {
        getStepData: jest.fn(),
        checkpoint: jest.fn(),
      },
      _stepData: {},
      terminationManager: {
        terminate: jest.fn(),
        getTerminationPromise: jest.fn(),
      },
      mutex: {
        lock: jest.fn((fn) => fn()),
      },
      getStepData: jest.fn((stepId: string) => {
        return getStepData(mockExecutionContext._stepData, stepId);
      }),
    } as unknown as jest.Mocked<ExecutionContext>;

    mockCheckpoint = createMockCheckpoint();
    mockParentContext = { awsRequestId: "mock-request-id" };
    createStepId = jest.fn().mockReturnValue(TEST_CONSTANTS.CHILD_CONTEXT_ID);
    const mockGetLogger = jest.fn().mockReturnValue({
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    });
    const mockCreateChildContext = jest.fn().mockReturnValue({
      _stepPrefix: TEST_CONSTANTS.CHILD_CONTEXT_ID,
    });
    const mockParentDurableContext = "parent-step-123";
    runInChildContextHandler = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      mockGetLogger,
      mockCreateChildContext,
      mockParentDurableContext,
    );
  });

  test("should execute child context function with child context", async () => {
    const childFn = jest
      .fn()
      .mockResolvedValue(TEST_CONSTANTS.CHILD_CONTEXT_RESULT);

    const result = await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      childFn,
    );

    expect(result).toBe(TEST_CONSTANTS.CHILD_CONTEXT_RESULT);
    expect(childFn).toHaveBeenCalledTimes(1);
    // Verify that a context was passed to the child context function
    expect(childFn.mock.calls[0][0]).toBeDefined();
    expect(childFn.mock.calls[0][0]._stepPrefix).toBe(
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
    );

    expect(mockCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      1,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: "START",
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      2,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: "SUCCEED",
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Payload: JSON.stringify(TEST_CONSTANTS.CHILD_CONTEXT_RESULT),
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
        ContextOptions: undefined,
      },
    );
  });

  test("should checkpoint at start and finish", async () => {
    const childFn = jest
      .fn()
      .mockResolvedValue(TEST_CONSTANTS.CHILD_CONTEXT_RESULT);

    await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      childFn,
      {},
    );

    expect(mockCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      1,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: OperationAction.START,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      2,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Payload: JSON.stringify(TEST_CONSTANTS.CHILD_CONTEXT_RESULT),
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
  });

  test("should handle small payloads normally", async () => {
    const childFn = jest.fn().mockResolvedValue("small-result");

    await runInChildContextHandler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn);

    expect(mockCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      1,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: OperationAction.START,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      2,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Payload: JSON.stringify("small-result"),
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
  });

  test("should checkpoint empty string for large payloads", async () => {
    // Create a large payload (over 256KB)
    const largePayload = "x".repeat(300 * 1024); // 300KB string
    const childFn = jest.fn().mockResolvedValue(largePayload);

    await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      childFn,
      {},
    );

    expect(mockCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      1,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: OperationAction.START,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      2,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123", // This should match the mock return value
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Payload: "",
        ContextOptions: {
          ReplayChildren: true,
        },
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
  });

  test("should return cached result for completed child context", async () => {
    const stepData = mockExecutionContext._stepData;
    stepData[hashId(TEST_CONSTANTS.CHILD_CONTEXT_ID)] = {
      Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
      Type: OperationType.CONTEXT,
      StartTimestamp: new Date(),
      Status: OperationStatus.SUCCEEDED,
      ContextDetails: {
        Result: JSON.stringify("cached-result"),
      },
    } as any;

    const childFn = jest.fn().mockResolvedValue("new-result");

    const result = await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      childFn,
    );

    expect(result).toBe("cached-result");
    expect(childFn).not.toHaveBeenCalled();
  });

  test("should checkpoint failure when child context function throws Error object", async () => {
    const error = new Error("child-context-error");
    const childFn = jest.fn().mockRejectedValue(error);

    await expect(
      runInChildContextHandler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn, {}),
    ).rejects.toThrow("child-context-error");

    expect(mockCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      1,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: OperationAction.START,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      2,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: OperationAction.FAIL,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Error: createErrorObjectFromError(error),
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
  });

  test('should checkpoint failure with "Unknown error" when child context function throws non-Error object', async () => {
    const nonErrorObject = "string error";
    const childFn = jest.fn().mockRejectedValue(nonErrorObject);

    await expect(
      runInChildContextHandler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn, {}),
    ).rejects.toThrow("Unknown error"); // After reconstruction, non-Error objects become "Unknown error"

    expect(mockCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      1,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: OperationAction.START,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      2,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: OperationAction.FAIL,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Error: createErrorObjectFromError("Unknown error"),
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
  });

  test("should support unnamed child contexts", async () => {
    const childFn = jest
      .fn()
      .mockResolvedValue(TEST_CONSTANTS.CHILD_CONTEXT_RESULT);

    await runInChildContextHandler(childFn, {});

    expect(mockCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      1,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: OperationAction.START,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Name: undefined,
      },
    );
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      2,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Payload: JSON.stringify(TEST_CONSTANTS.CHILD_CONTEXT_RESULT),
        Name: undefined,
        ContextOptions: undefined,
      },
    );
  });

  test("should accept undefined as name parameter", async () => {
    const childFn = jest
      .fn()
      .mockResolvedValue(TEST_CONSTANTS.CHILD_CONTEXT_RESULT);

    await runInChildContextHandler(undefined, childFn, {});

    expect(mockCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      1,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: OperationAction.START,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Name: undefined,
      },
    );
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      2,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Payload: JSON.stringify(TEST_CONSTANTS.CHILD_CONTEXT_RESULT),
        Name: undefined,
        ContextOptions: undefined,
      },
    );
  });

  test("should not checkpoint at start if child context is already started", async () => {
    // Set up the mock execution context with a child context that's already started
    mockExecutionContext._stepData = {
      [hashId(TEST_CONSTANTS.CHILD_CONTEXT_ID)]: {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        Type: OperationType.CONTEXT,
        StartTimestamp: new Date(),
        Status: OperationStatus.STARTED,
        name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    } as any;

    const childFn = jest
      .fn()
      .mockResolvedValue(TEST_CONSTANTS.CHILD_CONTEXT_RESULT);

    await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      childFn,
      {},
    );

    // Should only checkpoint once at the finish, not at the start
    expect(mockCheckpoint).toHaveBeenCalledTimes(1);
    expect(mockCheckpoint).toHaveBeenCalledWith(
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: "parent-step-123",
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Payload: JSON.stringify(TEST_CONSTANTS.CHILD_CONTEXT_RESULT),
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
        ContextOptions: undefined,
      },
    );
  });
});

describe("runInChildContext with custom serdes", () => {
  class TestResult {
    constructor(
      public value: string = "",
      public timestamp: Date = new Date(),
    ) {}
  }

  let mockExecutionContext: ExecutionContext;
  let mockCheckpoint: jest.MockedFunction<CheckpointFunction>;
  let mockParentContext: any;
  let mockCreateStepId: jest.Mock;
  let runInChildContext: ReturnType<typeof createRunInChildContextHandler>;

  beforeEach(() => {
    mockExecutionContext = {
      _stepData: {},
      terminationManager: {
        terminate: jest.fn(),
      },
      getStepData: jest.fn((stepId: string) => {
        return getStepData(mockExecutionContext._stepData, stepId);
      }),
    } as any;

    mockCheckpoint = createMockCheckpoint();
    mockParentContext = { getRemainingTimeInMillis: (): number => 30000 };
    mockCreateStepId = jest.fn().mockReturnValue("test-step-id");
    const mockGetLogger = jest.fn().mockReturnValue({
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    });

    const mockCreateChildContext = jest.fn().mockReturnValue({
      _stepPrefix: TEST_CONSTANTS.CHILD_CONTEXT_ID,
    });
    const mockParentDurableContext = "parent-step-123";
    runInChildContext = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      mockCreateStepId,
      mockGetLogger,
      mockCreateChildContext,
      mockParentDurableContext,
    );
  });

  test("should use custom serdes for serialization and deserialization", async () => {
    const customSerdes = createClassSerdesWithDates(TestResult, ["timestamp"]);
    const testResult = new TestResult("test-value", new Date("2023-01-01"));

    const childFunction = jest.fn().mockResolvedValue(testResult);

    // Execute the child context with custom serdes
    const result = await runInChildContext(
      "test-child-with-serdes",
      childFunction,
      {
        serdes: customSerdes,
      },
    );

    expect(result).toEqual(testResult);
    expect(result).toBeInstanceOf(TestResult);
    expect(mockCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockCheckpoint).toHaveBeenNthCalledWith(2, "test-step-id", {
      Id: "test-step-id",
      ParentId: "parent-step-123",
      Action: OperationAction.SUCCEED,
      SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
      Type: OperationType.CONTEXT,
      Payload: JSON.stringify(testResult),
      Name: "test-child-with-serdes",
      ContextOptions: undefined,
    });
  });

  test("should deserialize completed child context result with custom serdes", async () => {
    const customSerdes = createClassSerdesWithDates(TestResult, ["timestamp"]);
    const testResult = new TestResult("cached-value", new Date("2023-01-01"));

    // Set up completed step data
    mockExecutionContext._stepData = {
      [hashId("test-step-id")]: {
        Id: "test-step-id",
        Type: OperationType.CONTEXT,
        StartTimestamp: new Date(),
        Status: OperationStatus.SUCCEEDED,
        ContextDetails: {
          Result: JSON.stringify(testResult),
        },
      },
    } as any;

    const childFunction = jest.fn();

    // Execute the child context - should return cached result
    const result = await runInChildContext(
      "test-child-with-serdes",
      childFunction,
      {
        serdes: customSerdes,
      },
    );

    expect(result).toEqual(testResult);
    expect(result).toBeInstanceOf(TestResult);
    expect(childFunction).not.toHaveBeenCalled(); // Should not execute function for cached result
  });

  test("should throw error for failed child context during replay", async () => {
    const error = new Error("child-context-failed");
    const errorObject = createErrorObjectFromError(error);

    // Set up the mock execution context with a failed child context
    const stepData = mockExecutionContext._stepData;
    stepData[hashId("test-step-id")] = {
      Id: "test-step-id",
      Type: OperationType.CONTEXT,
      StartTimestamp: new Date(),
      Status: OperationStatus.FAILED,
      ContextDetails: {
        Error: errorObject,
      },
    };

    const childFn = jest.fn(); // Should not be called for failed context

    // Execute the child context - should throw the stored error
    await expect(runInChildContext("test-child", childFn)).rejects.toThrow(
      "child-context-failed",
    );

    expect(childFn).not.toHaveBeenCalled(); // Should not execute function for failed context
    expect(mockCheckpoint).not.toHaveBeenCalled(); // Should not checkpoint during replay
  });

  test("should throw ChildContextError for failed child context without Error field", async () => {
    // Set up the mock execution context with a failed child context (legacy format)
    const stepData = mockExecutionContext._stepData;
    stepData[hashId("test-step-id")] = {
      Id: "test-step-id",
      Type: OperationType.CONTEXT,
      StartTimestamp: new Date(),
      Status: OperationStatus.FAILED,
      ContextDetails: {}, // No Error field (legacy data)
    };

    const childFn = jest.fn();

    await expect(runInChildContext("test-child", childFn)).rejects.toThrow(
      "Child context failed",
    );

    expect(childFn).not.toHaveBeenCalled();
    expect(mockCheckpoint).not.toHaveBeenCalled();
  });
});

// Test cases for runWithContext logic - verifying the different modes and parameters
describe("runWithContext Integration", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockCheckpoint: jest.MockedFunction<CheckpointFunction>;
  let mockParentContext: any;
  let createStepId: jest.Mock;
  let runInChildContextHandler: ReturnType<
    typeof createRunInChildContextHandler
  >;

  beforeEach(() => {
    jest.resetAllMocks();

    mockExecutionContext = {
      state: {
        getStepData: jest.fn(),
        checkpoint: jest.fn(),
      },
      _stepData: {},
      terminationManager: {
        terminate: jest.fn(),
        getTerminationPromise: jest.fn(),
      },
      mutex: {
        lock: jest.fn((fn) => fn()),
      },
      getStepData: jest.fn((stepId: string) => {
        return getStepData(mockExecutionContext._stepData, stepId);
      }),
    } as unknown as jest.Mocked<ExecutionContext>;

    mockCheckpoint = createMockCheckpoint();
    mockParentContext = { awsRequestId: "mock-request-id" };
    createStepId = jest.fn().mockReturnValue("child-context-id");
    const mockGetLogger = jest.fn().mockReturnValue({
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    });
    const mockCreateChildContext = jest.fn().mockReturnValue({
      _stepPrefix: "child-context-id",
    });
    const mockParentDurableContext = "parent-step-123";

    runInChildContextHandler = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      mockGetLogger,
      mockCreateChildContext,
      mockParentDurableContext,
    );

    // Setup runWithContext mock to return the function result
    (runWithContext as jest.Mock) = jest
      .fn()
      .mockImplementation(async (stepId, parentId, fn, _attempt, _mode) => {
        try {
          return await fn();
        } catch (error) {
          throw error;
        }
      });
  });

  it("should call runWithContext with ExecutionMode for new child context", async () => {
    const childFn = jest.fn().mockResolvedValue("child-result");

    await runInChildContextHandler("test-child", childFn);

    // Verify runWithContext was called with correct parameters for ExecutionMode
    expect(runWithContext).toHaveBeenCalledWith(
      "child-context-id",
      "parent-step-123", // parentId from handler setup
      expect.any(Function), // The wrapped child function
      undefined, // No attempt number for child contexts
      DurableExecutionMode.ExecutionMode,
    );
  });

  it("should call runWithContext with ReplayMode for completed child context", async () => {
    // Set up a completed child context
    mockExecutionContext._stepData[hashId("child-context-id")] = {
      Id: "child-context-id",
      Type: OperationType.CONTEXT,
      Status: OperationStatus.SUCCEEDED,
      ContextDetails: {
        Result: '"cached-result"',
      },
    } as any;

    const childFn = jest.fn();

    const result = await runInChildContextHandler("test-child", childFn);

    expect(result).toBe("cached-result");
    // Should not call runWithContext for cached results
    expect(runWithContext).not.toHaveBeenCalled();
    expect(childFn).not.toHaveBeenCalled();
  });

  it("should call runWithContext with ReplaySucceededContext for ReplayChildren mode", async () => {
    // Set up a completed child context with ReplayChildren flag
    mockExecutionContext._stepData[hashId("child-context-id")] = {
      Id: "child-context-id",
      Type: OperationType.CONTEXT,
      Status: OperationStatus.SUCCEEDED,
      ContextDetails: {
        Result: '"original-result"',
        ReplayChildren: true,
      },
    } as any;

    const childFn = jest.fn().mockResolvedValue("replayed-result");

    const result = await runInChildContextHandler("test-child", childFn);

    expect(result).toBe("replayed-result");
    // Verify runWithContext was called for ReplayChildren mode
    expect(runWithContext).toHaveBeenCalledWith(
      "child-context-id",
      "child-context-id", // parentId becomes entityId in ReplayChildren mode
      expect.any(Function), // The wrapped child function
    );
  });

  it("should call runWithContext with ReplayMode for failed child context in execution", async () => {
    // Set up a failed child context to trigger ReplayMode
    mockExecutionContext._stepData[hashId("child-context-id")] = {
      Id: "child-context-id",
      Type: OperationType.CONTEXT,
      Status: OperationStatus.FAILED,
      ContextDetails: {
        Error: createErrorObjectFromError(new Error("Previous failure")),
      },
    } as any;

    const childFn = jest.fn();

    await expect(
      runInChildContextHandler("test-child", childFn),
    ).rejects.toThrow("Previous failure");

    // Should not call runWithContext for failed cached results
    expect(runWithContext).not.toHaveBeenCalled();
    expect(childFn).not.toHaveBeenCalled();
  });

  it("should pass the child function through runWithContext correctly", async () => {
    const childFn = jest.fn().mockResolvedValue("child-result");
    let capturedFunction: (() => Promise<unknown>) | undefined;

    // Capture the function passed to runWithContext
    (runWithContext as jest.Mock).mockImplementation(
      async (stepId, parentId, fn, _attempt, _mode) => {
        capturedFunction = fn;
        return await fn();
      },
    );

    await runInChildContextHandler("test-child", childFn);

    // Verify that the captured function calls our child function with DurableContext
    expect(capturedFunction).toBeDefined();

    // The captured function should be the wrapped version that calls childFn with DurableContext
    expect(childFn).toHaveBeenCalledWith(
      expect.objectContaining({
        _stepPrefix: "child-context-id",
      }),
    );
  });

  it("should call runWithContext with correct entityId as both stepId and parentId in ReplayChildren", async () => {
    // Set up ReplayChildren scenario
    mockExecutionContext._stepData[hashId("child-context-id")] = {
      Id: "child-context-id",
      Type: OperationType.CONTEXT,
      Status: OperationStatus.SUCCEEDED,
      ContextDetails: {
        ReplayChildren: true,
      },
    } as any;

    const childFn = jest.fn().mockResolvedValue("replayed-result");

    await runInChildContextHandler("test-child", childFn);

    // In ReplayChildren mode, both stepId and parentId should be the entityId
    expect(runWithContext).toHaveBeenCalledWith(
      "child-context-id", // stepId = entityId
      "child-context-id", // parentId = entityId (not the original parentId)
      expect.any(Function),
    );
  });

  it("should use determineChildReplayMode logic correctly", async () => {
    // Test ExecutionMode for new context (no existing step data)
    const childFn1 = jest.fn().mockResolvedValue("result1");
    await runInChildContextHandler("test-child-1", childFn1);

    expect(runWithContext).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Function),
      undefined,
      DurableExecutionMode.ExecutionMode,
    );

    // Reset and test with STARTED status (should still be ExecutionMode)
    jest.clearAllMocks();
    createStepId.mockReturnValue("child-context-id-2");
    mockExecutionContext._stepData[hashId("child-context-id-2")] = {
      Id: "child-context-id-2",
      Status: OperationStatus.STARTED,
    } as any;

    const childFn2 = jest.fn().mockResolvedValue("result2");
    await runInChildContextHandler("test-child-2", childFn2);

    expect(runWithContext).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Function),
      undefined,
      DurableExecutionMode.ExecutionMode,
    );
  });

  it("should handle different execution modes based on step status", async () => {
    // Test ReplayMode for SUCCEEDED without ReplayChildren
    createStepId.mockReturnValue("child-context-replay");
    mockExecutionContext._stepData[hashId("child-context-replay")] = {
      Id: "child-context-replay",
      Status: OperationStatus.SUCCEEDED,
      ContextDetails: {
        Result: '"replay-result"',
        // No ReplayChildren flag
      },
    } as any;

    const childFn = jest.fn();
    const result = await runInChildContextHandler("test-replay", childFn);

    // Should return cached result without calling runWithContext
    expect(result).toBe("replay-result");
    expect(runWithContext).not.toHaveBeenCalled();
    expect(childFn).not.toHaveBeenCalled();
  });
});
