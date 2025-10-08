import {
  createRunInChildContextHandler,
  determineChildReplayMode,
} from "./run-in-child-context-handler";
import {
  ExecutionContext,
  OperationSubType,
  DurableExecutionMode,
} from "../../types";
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
import { OperationInterceptor } from "../../mocks/operation-interceptor";
import { hashId, getStepData } from "../../utils/step-id-utils/step-id-utils";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";

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
      isVerbose: false,
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
    runInChildContextHandler = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      mockGetLogger,
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
        Action: "SUCCEED",
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Payload: JSON.stringify(TEST_CONSTANTS.CHILD_CONTEXT_RESULT),
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
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
        ParentId: mockExecutionContext.parentId,
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

    expect(mockCheckpoint).toHaveBeenCalledWith(
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
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
    ).rejects.toBe(nonErrorObject);

    expect(mockCheckpoint).toHaveBeenCalledWith(
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
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

    expect(mockCheckpoint).toHaveBeenCalledWith(
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Payload: JSON.stringify(TEST_CONSTANTS.CHILD_CONTEXT_RESULT),
        Name: undefined,
      },
    );
  });

  test("should accept undefined as name parameter", async () => {
    const childFn = jest
      .fn()
      .mockResolvedValue(TEST_CONSTANTS.CHILD_CONTEXT_RESULT);

    await runInChildContextHandler(undefined, childFn, {});

    expect(mockCheckpoint).toHaveBeenCalledWith(
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Payload: JSON.stringify(TEST_CONSTANTS.CHILD_CONTEXT_RESULT),
        Name: undefined,
      },
    );
  });

  test("should not checkpoint at start if child context is already started", async () => {
    // Set up the mock execution context with a child context that's already started
    mockExecutionContext._stepData = {
      [hashId(TEST_CONSTANTS.CHILD_CONTEXT_ID)]: {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        Status: OperationStatus.STARTED,
        type: OperationType.STEP,
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
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Payload: JSON.stringify(TEST_CONSTANTS.CHILD_CONTEXT_RESULT),
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
  });

  describe("ParentId Handling", () => {
    test("should include ParentId in checkpoints", async () => {
      mockExecutionContext.parentId = "parent-step-123";

      const childFn = jest.fn().mockResolvedValue("child-result");

      await runInChildContextHandler(
        TEST_CONSTANTS.CHILD_CONTEXT_NAME,
        childFn,
        {},
      );

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
    });

    test("should include ParentId in SUCCEED checkpoint", async () => {
      mockExecutionContext.parentId = "parent-step-456";

      const childFn = jest.fn().mockResolvedValue("child-result");

      await runInChildContextHandler(
        TEST_CONSTANTS.CHILD_CONTEXT_NAME,
        childFn,
        {},
      );

      expect(mockCheckpoint).toHaveBeenCalledWith(
        TEST_CONSTANTS.CHILD_CONTEXT_ID,
        {
          Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
          ParentId: "parent-step-456",
          Action: OperationAction.SUCCEED,
          SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
          Type: OperationType.CONTEXT,
          Payload: JSON.stringify("child-result"),
          Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
        },
      );
    });

    test("should include ParentId in FAIL checkpoint when child context throws error", async () => {
      mockExecutionContext.parentId = "parent-step-789";

      const error = new Error("child-context-error");
      const childFn = jest.fn().mockRejectedValue(error);

      await expect(
        runInChildContextHandler(
          TEST_CONSTANTS.CHILD_CONTEXT_NAME,
          childFn,
          {},
        ),
      ).rejects.toThrow("child-context-error");

      expect(mockCheckpoint).toHaveBeenCalledWith(
        TEST_CONSTANTS.CHILD_CONTEXT_ID,
        {
          Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
          ParentId: "parent-step-789",
          Action: OperationAction.FAIL,
          SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
          Type: OperationType.CONTEXT,
          Error: createErrorObjectFromError(error),
          Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
        },
      );
    });

    test("should include ParentId as undefined when context has no parentId", async () => {
      mockExecutionContext.parentId = undefined;

      const childFn = jest.fn().mockResolvedValue("child-result");

      await runInChildContextHandler(
        TEST_CONSTANTS.CHILD_CONTEXT_NAME,
        childFn,
        {},
      );

      expect(mockCheckpoint).toHaveBeenCalledWith(
        TEST_CONSTANTS.CHILD_CONTEXT_ID,
        {
          Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
          ParentId: undefined,
          Action: OperationAction.SUCCEED,
          SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
          Type: OperationType.CONTEXT,
          Payload: JSON.stringify("child-result"),
          Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
        },
      );
    });
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
      isVerbose: false,
      getStepData: jest.fn((stepId: string) => {
        return getStepData(mockExecutionContext._stepData, stepId);
      }),
    } as any;

    mockCheckpoint = createMockCheckpoint();
    mockParentContext = { getRemainingTimeInMillis: () => 30000 };
    mockCreateStepId = jest.fn().mockReturnValue("test-step-id");
    const mockGetLogger = jest.fn().mockReturnValue({
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    });

    runInChildContext = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      mockCreateStepId,
      mockGetLogger,
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
    expect(mockCheckpoint).toHaveBeenCalledWith("test-step-id", {
      Id: "test-step-id",
      Action: OperationAction.SUCCEED,
      SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
      Type: OperationType.CONTEXT,
      Payload: JSON.stringify(testResult),
      Name: "test-child-with-serdes",
    });
  });

  test("should deserialize completed child context result with custom serdes", async () => {
    const customSerdes = createClassSerdesWithDates(TestResult, ["timestamp"]);
    const testResult = new TestResult("cached-value", new Date("2023-01-01"));

    // Set up completed step data
    mockExecutionContext._stepData = {
      [hashId("test-step-id")]: {
        Id: "test-step-id",
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
});

describe("Mock Integration", () => {
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
    OperationInterceptor.clearAll();

    mockExecutionContext = {
      _stepData: {},
      durableExecutionArn: "test-execution-arn",
      terminationManager: {
        terminate: jest.fn(),
        getTerminationPromise: jest.fn(),
      },
      isVerbose: false,
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
    runInChildContextHandler = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      mockGetLogger,
    );
  });

  test("should use mock callback when mock is registered", async () => {
    const originalChildFn = jest.fn().mockResolvedValue("original-result");
    const mockCallback = jest.fn().mockResolvedValue("mocked-result");

    // Register a mock for the child context
    OperationInterceptor.forExecution(mockExecutionContext.durableExecutionArn)
      .onName(TEST_CONSTANTS.CHILD_CONTEXT_NAME)
      .mock(mockCallback);

    const result = await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      originalChildFn,
    );

    expect(result).toBe("mocked-result");
    expect(mockCallback).toHaveBeenCalledTimes(1);
    expect(originalChildFn).not.toHaveBeenCalled();
  });

  test("should handle index-based mocks for unnamed child contexts", async () => {
    const originalChildFn = jest.fn().mockResolvedValue("original-result");
    const mockCallback = jest.fn().mockResolvedValue("mocked-result");

    // Register an index-based mock (first operation = index 0)
    OperationInterceptor.forExecution(mockExecutionContext.durableExecutionArn)
      .onIndex(0)
      .mock(mockCallback);

    const result = await runInChildContextHandler(originalChildFn);

    expect(result).toBe("mocked-result");
    expect(mockCallback).toHaveBeenCalledTimes(1);
    expect(originalChildFn).not.toHaveBeenCalled();
  });

  test("should handle sequential mock execution", async () => {
    const originalChildFn1 = jest.fn().mockResolvedValue("original-1");
    const originalChildFn2 = jest.fn().mockResolvedValue("original-2");
    const mockCallback1 = jest.fn().mockResolvedValue("mock-1");
    const mockCallback2 = jest.fn().mockResolvedValue("mock-2");

    // Register mocks for sequential child contexts
    OperationInterceptor.forExecution(mockExecutionContext.durableExecutionArn)
      .onName("child-context-1")
      .mock(mockCallback1);

    OperationInterceptor.forExecution(mockExecutionContext.durableExecutionArn)
      .onName("child-context-2")
      .mock(mockCallback2);

    // Execute first child context
    createStepId.mockReturnValueOnce("child-1-id");
    const result1 = await runInChildContextHandler(
      "child-context-1",
      originalChildFn1,
    );

    // Execute second child context
    createStepId.mockReturnValueOnce("child-2-id");
    const result2 = await runInChildContextHandler(
      "child-context-2",
      originalChildFn2,
    );

    expect(result1).toBe("mock-1");
    expect(result2).toBe("mock-2");
    expect(mockCallback1).toHaveBeenCalledTimes(1);
    expect(mockCallback2).toHaveBeenCalledTimes(1);
    expect(originalChildFn1).not.toHaveBeenCalled();
    expect(originalChildFn2).not.toHaveBeenCalled();
  });

  test("should handle mock chaining with finite count", async () => {
    const originalChildFn = jest.fn().mockResolvedValue("original-result");
    const mock1 = jest.fn().mockResolvedValue("mock-1");
    const mock2 = jest.fn().mockResolvedValue("mock-2");

    // Register mocks with finite counts
    OperationInterceptor.forExecution(mockExecutionContext.durableExecutionArn)
      .onName(TEST_CONSTANTS.CHILD_CONTEXT_NAME)
      .mock(mock1, 1); // First call only

    OperationInterceptor.forExecution(mockExecutionContext.durableExecutionArn)
      .onName(TEST_CONSTANTS.CHILD_CONTEXT_NAME)
      .mock(mock2, 1); // Second call only

    // First call should use mock1
    createStepId.mockReturnValueOnce("child-1-id");
    const result1 = await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      originalChildFn,
    );

    // Second call should use mock2
    createStepId.mockReturnValueOnce("child-2-id");
    const result2 = await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      originalChildFn,
    );

    // Third call should use original function
    createStepId.mockReturnValueOnce("child-3-id");
    const result3 = await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      originalChildFn,
    );

    expect(result1).toBe("mock-1");
    expect(result2).toBe("mock-2");
    expect(result3).toBe("original-result");
    expect(originalChildFn).toHaveBeenCalledTimes(1);
  });

  test("should handle already completed child contexts regardless of mocks", async () => {
    const originalChildFn = jest.fn().mockResolvedValue("original-result");
    const mockCallback = jest.fn().mockResolvedValue("mocked-result");

    // Register a mock
    OperationInterceptor.forExecution(mockExecutionContext.durableExecutionArn)
      .onName("completed-child-context")
      .mock(mockCallback);

    // Set up a child context that was already completed
    mockExecutionContext._stepData = {
      [hashId(TEST_CONSTANTS.CHILD_CONTEXT_ID)]: {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        Status: OperationStatus.SUCCEEDED,
        ContextDetails: {
          Result: JSON.stringify("cached-result"),
        },
      },
    } as any;

    const result = await runInChildContextHandler(
      "completed-child-context",
      originalChildFn,
    );

    // Should return cached result, not mock result
    expect(result).toBe("cached-result");
    expect(originalChildFn).not.toHaveBeenCalled();
    expect(mockCallback).not.toHaveBeenCalled();
  });

  test("should handle mocked child context with checkpointing", async () => {
    const originalChildFn = jest.fn().mockResolvedValue("original-result");
    const mockCallback = jest.fn().mockResolvedValue("mocked-result");

    // Register a mock
    OperationInterceptor.forExecution(mockExecutionContext.durableExecutionArn)
      .onName(TEST_CONSTANTS.CHILD_CONTEXT_NAME)
      .mock(mockCallback);

    const result = await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      originalChildFn,
    );

    expect(result).toBe("mocked-result");
    expect(mockCallback).toHaveBeenCalledTimes(1);
    expect(originalChildFn).not.toHaveBeenCalled();

    // Should still checkpoint the mocked result
    expect(mockCheckpoint).toHaveBeenCalledWith(
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Payload: JSON.stringify("mocked-result"),
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
  });

  test("should handle mock errors in child context execution", async () => {
    const originalChildFn = jest.fn().mockResolvedValue("original-result");
    const mockError = new Error("mock-error");
    const mockCallback = jest.fn().mockRejectedValue(mockError);

    // Register a mock that throws an error
    OperationInterceptor.forExecution(mockExecutionContext.durableExecutionArn)
      .onName(TEST_CONSTANTS.CHILD_CONTEXT_NAME)
      .mock(mockCallback);

    await expect(
      runInChildContextHandler(
        TEST_CONSTANTS.CHILD_CONTEXT_NAME,
        originalChildFn,
        {},
      ),
    ).rejects.toThrow("mock-error");

    expect(mockCallback).toHaveBeenCalledTimes(1);
    expect(originalChildFn).not.toHaveBeenCalled();

    // Should checkpoint the failure
    expect(mockCheckpoint).toHaveBeenCalledWith(
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        Action: OperationAction.FAIL,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Error: createErrorObjectFromError(mockError),
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
  });

  test("should use custom summaryGenerator for large payloads", async () => {
    const largePayload = { data: "x".repeat(300000) };
    const childFn = jest.fn().mockResolvedValue(largePayload);
    const summaryGenerator = jest
      .fn()
      .mockReturnValue("Custom summary of large data");

    await runInChildContextHandler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn, {
      summaryGenerator,
    });

    expect(summaryGenerator).toHaveBeenCalledWith(largePayload);
    expect(mockCheckpoint).toHaveBeenNthCalledWith(
      2,
      TEST_CONSTANTS.CHILD_CONTEXT_ID,
      {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
        ParentId: mockExecutionContext.parentId,
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
        Type: OperationType.CONTEXT,
        Payload: "Custom summary of large data",
        ContextOptions: {
          ReplayChildren: true,
        },
        Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      },
    );
  });

  test("should re-execute child context when ReplayChildren is true", async () => {
    const stepData = mockExecutionContext._stepData;
    stepData[hashId(TEST_CONSTANTS.CHILD_CONTEXT_ID)] = {
      Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
      Status: OperationStatus.SUCCEEDED,
      ContextDetails: {
        Result: "Summary of large payload",
        ReplayChildren: true,
      },
    } as any;

    const childFn = jest.fn().mockResolvedValue("re-executed-result");

    const result = await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      childFn,
    );

    expect(result).toBe("re-executed-result");
    expect(childFn).toHaveBeenCalledTimes(1);
  });

  test("should handle child context with succeeded status and ReplayChildren", async () => {
    mockExecutionContext._stepData = {
      [TEST_CONSTANTS.CHILD_CONTEXT_STEP_ID]: {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_STEP_ID,
        Status: OperationStatus.SUCCEEDED,
        ContextDetails: {
          ReplayChildren: true,
          Result: JSON.stringify("cached-result"),
        },
      },
    };

    const childFn = jest.fn().mockResolvedValue("re-executed-result");
    const result = await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      childFn,
    );

    expect(result).toBe("re-executed-result");
    expect(childFn).toHaveBeenCalledTimes(1);
  });

  test("should handle child context with non-succeeded status", async () => {
    mockExecutionContext._stepData = {
      [TEST_CONSTANTS.CHILD_CONTEXT_STEP_ID]: {
        Id: TEST_CONSTANTS.CHILD_CONTEXT_STEP_ID,
        Status: OperationStatus.STARTED,
      },
    };

    const childFn = jest.fn().mockResolvedValue("new-result");
    const result = await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      childFn,
    );

    expect(result).toBe("new-result");
    expect(childFn).toHaveBeenCalledTimes(1);
  });

  describe("determineChildReplayMode", () => {
    test("should return ReplaySucceededContext for succeeded step with ReplayChildren", () => {
      const stepId = "test-step-id";
      mockExecutionContext._stepData = {
        [hashId(stepId)]: {
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: { ReplayChildren: true },
        },
      };

      const result = determineChildReplayMode(mockExecutionContext, stepId);
      expect(result).toBe(DurableExecutionMode.ReplaySucceededContext);
    });

    test("should return ReplayMode for succeeded step without ReplayChildren", () => {
      const stepId = "test-step-id";
      mockExecutionContext._stepData = {
        [hashId(stepId)]: {
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: {},
        },
      };

      const result = determineChildReplayMode(mockExecutionContext, stepId);
      expect(result).toBe(DurableExecutionMode.ReplayMode);
    });

    test("should return ReplayMode for failed step", () => {
      const stepId = "test-step-id";
      mockExecutionContext._stepData = {
        [hashId(stepId)]: {
          Status: OperationStatus.FAILED,
        },
      };

      const result = determineChildReplayMode(mockExecutionContext, stepId);
      expect(result).toBe(DurableExecutionMode.ReplayMode);
    });
  });
});
