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
    ).rejects.toBe(nonErrorObject);

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
});
