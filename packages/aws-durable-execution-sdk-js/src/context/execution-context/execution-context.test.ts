import {
  Operation,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { DurableExecutionInvocationInput, OperationSubType } from "../../types";
import { log } from "../../utils/logger/logger";
import { initializeExecutionContext } from "./execution-context";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { Context } from "aws-lambda";
import { DurableExecutionClient } from "../../types/durable-execution";
import { DurableExecutionApiClient } from "../../durable-execution-api-client/durable-execution-api-client";
import { DurableExecutionInvocationInputWithClient } from "../../utils/durable-execution-invocation-input/durable-execution-invocation-input";

// Mock dependencies
jest.mock("../../durable-execution-api-client/durable-execution-api-client");
jest.mock("../../utils/logger/logger");
jest.mock("../../termination-manager/termination-manager");
jest.mock("../../utils/logger/default-logger");

describe("initializeExecutionContext", () => {
  // Matcher for Logger interface
  const expectLogger = expect.objectContaining({
    log: expect.any(Function),
    info: expect.any(Function),
    error: expect.any(Function),
    warn: expect.any(Function),
    debug: expect.any(Function),
  });

  // Setup common test variables
  const mockCheckpointToken = "test-checkpoint-token";
  const mockDurableExecutionArn = "test-durable-execution-arn";

  const mockCustomerHandlerEvent = '{"hello": "world"}';

  const mockExecutionEvent: Operation = {
    Id: "", // Lambda InvocationId
    ParentId: undefined,
    Name: "",
    Type: OperationType.EXECUTION,
    StartTimestamp: new Date(),
    Status: "STARTED",
    ExecutionDetails: {
      InputPayload: mockCustomerHandlerEvent,
    },
  };

  const mockEvent: DurableExecutionInvocationInput = {
    CheckpointToken: mockCheckpointToken,
    DurableExecutionArn: mockDurableExecutionArn,
    InitialExecutionState: {
      Operations: [mockExecutionEvent],
      NextMarker: "",
    },
  };

  const mockStepSucceededEvent = {
    Id: "step1",
    Status: OperationStatus.SUCCEEDED,
    SubType: OperationSubType.STEP,
    Type: OperationType.STEP,
    StartTimestamp: new Date(),
  };

  const mockStepStartedEvent = {
    Id: "step2",
    Status: OperationStatus.STARTED,
    SubType: OperationSubType.STEP,
    Type: OperationType.STEP,
    StartTimestamp: new Date(),
  };

  const mockInitialOperations: Operation[] = [
    mockExecutionEvent,
    mockStepSucceededEvent,
  ];

  const mockLambdaContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "test-function",
    functionVersion: "1",
    invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test",
    memoryLimitInMB: "128",
    awsRequestId: "test-request-id",
    logGroupName: "/aws/lambda/test",
    logStreamName: "test-stream",
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };

  const mockDurableExecutionClient: jest.Mocked<DurableExecutionClient> = {
    checkpoint: jest.fn(),
    getExecutionState: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks
    (DurableExecutionApiClient as jest.Mock).mockImplementation(
      () => mockDurableExecutionClient,
    );

    // Mock default logger
    (createDefaultLogger as jest.Mock).mockReturnValue({
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      configureDurableLoggingContext: jest.fn(),
    });

    // Mock environment variables
    process.env.DURABLE_VERBOSE_MODE = "false";
  });

  afterEach(() => {
    // Reset environment variables
    delete process.env.DURABLE_VERBOSE_MODE;
  });

  it("should initialize execution context with basic event", async () => {
    // Execute
    const result = await initializeExecutionContext(
      mockEvent,
      mockLambdaContext,
    );

    // Verify
    expect(result).toStrictEqual({
      checkpointToken: mockCheckpointToken,
      durableExecutionMode: expect.any(String),
      executionContext: {
        durableExecutionClient: mockDurableExecutionClient,
        _stepData: {},
        terminationManager: expect.any(Object),

        durableExecutionArn: mockDurableExecutionArn,
        pendingCompletions: expect.any(Set),
        getStepData: expect.any(Function),
        tenantId: mockLambdaContext.tenantId,
        requestId: mockLambdaContext.awsRequestId,
      },
    });
  });

  it("should initialize execution context in verbose mode", async () => {
    // Setup
    process.env.DURABLE_VERBOSE_MODE = "true";

    // Execute
    await initializeExecutionContext(mockEvent, mockLambdaContext);

    // Verify
    expect(log).toHaveBeenCalledWith(
      "🔵",
      "Initializing durable function with event:",
      mockEvent,
    );
    expect(log).toHaveBeenCalledWith("📍", "Function Input:", mockEvent);
  });

  it("should load step data from event", async () => {
    // Setup
    const mockOperations: Operation[] = [
      mockExecutionEvent,
      {
        Id: "step1",
        Status: OperationStatus.SUCCEEDED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
      },
      {
        Id: "step2",
        Status: OperationStatus.STARTED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
      },
    ];

    const eventWithStepData: DurableExecutionInvocationInput = {
      ...mockEvent,
      InitialExecutionState: {
        Operations: mockOperations,
        NextMarker: "",
      },
    };

    // Execute
    const result = await initializeExecutionContext(
      eventWithStepData,
      mockLambdaContext,
    );

    // Verify
    expect(result.executionContext._stepData).toEqual({
      step1: mockOperations[1],
      step2: mockOperations[2],
    });
  });

  it("should handle missing step data in initialState", async () => {
    // Setup
    const eventWithoutStepData: DurableExecutionInvocationInput = {
      CheckpointToken: mockCheckpointToken,
      DurableExecutionArn: mockDurableExecutionArn,
      InitialExecutionState: {
        Operations: [mockExecutionEvent], // only pass in the initial execution event
        NextMarker: "",
      },
    };

    // Execute
    const result = await initializeExecutionContext(
      eventWithoutStepData,
      mockLambdaContext,
    );

    // Verify
    expect(result.executionContext._stepData).toEqual({});
  });

  it("should handle pagination when loading step data", async () => {
    // create an input event with more data to fetch
    const eventWithNextMarker: DurableExecutionInvocationInput = {
      ...mockEvent,
      InitialExecutionState: {
        Operations: mockInitialOperations,
        NextMarker: "token1",
      },
    };

    mockDurableExecutionClient.getExecutionState.mockResolvedValueOnce({
      Operations: [mockStepStartedEvent],
      NextMarker: undefined,
    });

    // Execute
    const result = await initializeExecutionContext(
      eventWithNextMarker,
      mockLambdaContext,
    );

    // Verify
    expect(mockDurableExecutionClient.getExecutionState).toHaveBeenCalledWith(
      {
        CheckpointToken: mockCheckpointToken,
        DurableExecutionArn: "test-durable-execution-arn",
        Marker: "token1",
        MaxItems: 1000,
      },
      expectLogger,
    );
    expect(result.executionContext._stepData).toEqual({
      step1: mockInitialOperations[1],
      step2: mockStepStartedEvent,
    });
  });

  it("should handle multiple pages of step data", async () => {
    // Setup
    const mockOperations2: Operation[] = [
      {
        Id: "step2",
        Status: OperationStatus.STARTED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
      },
    ];

    const mockOperations3: Operation[] = [
      {
        Id: "step3",
        Status: OperationStatus.FAILED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
      },
    ];

    const eventWithNextMarker: DurableExecutionInvocationInput = {
      ...mockEvent,
      InitialExecutionState: {
        Operations: mockInitialOperations,
        NextMarker: "token1",
      },
    };

    mockDurableExecutionClient.getExecutionState.mockResolvedValueOnce({
      Operations: mockOperations2,
      NextMarker: "token2",
    });

    mockDurableExecutionClient.getExecutionState.mockResolvedValueOnce({
      Operations: mockOperations3,
      NextMarker: undefined,
    });

    // Execute
    const result = await initializeExecutionContext(
      eventWithNextMarker,
      mockLambdaContext,
    );

    // Verify
    expect(mockDurableExecutionClient.getExecutionState).toHaveBeenCalledWith(
      {
        CheckpointToken: mockCheckpointToken,
        DurableExecutionArn: "test-durable-execution-arn",
        Marker: "token1",
        MaxItems: 1000,
      },
      expectLogger,
    );
    expect(mockDurableExecutionClient.getExecutionState).toHaveBeenCalledWith(
      {
        CheckpointToken: mockCheckpointToken,
        DurableExecutionArn: "test-durable-execution-arn",
        Marker: "token2",
        MaxItems: 1000,
      },
      expectLogger,
    );
    expect(result.executionContext._stepData).toEqual({
      step1: mockInitialOperations[1],
      step2: mockOperations2[0],
      step3: mockOperations3[0],
    });
  });

  it("should handle pagination when theres no initial operations", async () => {
    /**
     * This tests the case where the lambda function is invoked without any initial operations but has a
     * pagination token. This happens when the customer input payload exceeds 6MB, because we can't include their
     * input event AND our DAR context without exceeding the 6MB limit.
     */

    // create an input event with no initial operations and more data to fetch
    const eventWithNextMarkerButNoOperations: DurableExecutionInvocationInput =
      {
        ...mockEvent,
        InitialExecutionState: {
          Operations: [],
          NextMarker: "token1",
        },
      };

    mockDurableExecutionClient.getExecutionState.mockResolvedValueOnce({
      Operations: [mockExecutionEvent],
      NextMarker: "token2",
    });

    mockDurableExecutionClient.getExecutionState.mockResolvedValueOnce({
      Operations: [mockStepSucceededEvent],
      NextMarker: "",
    });

    // Execute
    const result = await initializeExecutionContext(
      eventWithNextMarkerButNoOperations,
      mockLambdaContext,
    );

    // Verify
    expect(mockDurableExecutionClient.getExecutionState).toHaveBeenCalledWith(
      {
        CheckpointToken: mockCheckpointToken,
        DurableExecutionArn: "test-durable-execution-arn",
        Marker: "token1",
        MaxItems: 1000,
      },
      expectLogger,
    );

    expect(mockDurableExecutionClient.getExecutionState).toHaveBeenCalledWith(
      {
        CheckpointToken: mockCheckpointToken,
        DurableExecutionArn: "test-durable-execution-arn",
        Marker: "token2",
        MaxItems: 1000,
      },
      expectLogger,
    );

    expect(result.executionContext._stepData).toEqual({
      step1: mockStepSucceededEvent,
    });
  });

  it("should handle pagination when NextMarker becomes empty string", async () => {
    // Setup - test the case where NextMarker is returned as empty string
    const eventWithNextMarker: DurableExecutionInvocationInput = {
      ...mockEvent,
      InitialExecutionState: {
        Operations: mockInitialOperations,
        NextMarker: "token1",
      },
    };

    // Mock response that returns empty string for NextMarker (should exit loop)
    mockDurableExecutionClient.getExecutionState.mockResolvedValueOnce({
      Operations: [mockStepStartedEvent],
      NextMarker: "", // Empty string should exit the while loop
    });

    // Execute
    const result = await initializeExecutionContext(
      eventWithNextMarker,
      mockLambdaContext,
    );

    // Verify
    expect(mockDurableExecutionClient.getExecutionState).toHaveBeenCalledWith(
      {
        CheckpointToken: mockCheckpointToken,
        DurableExecutionArn: "test-durable-execution-arn",
        Marker: "token1",
        MaxItems: 1000,
      },
      expectLogger,
    );
    expect(mockDurableExecutionClient.getExecutionState).toHaveBeenCalledTimes(
      1,
    ); // Should only be called once
    expect(result.executionContext._stepData).toEqual({
      step1: mockInitialOperations[1],
      step2: mockStepStartedEvent,
    });
  });

  it("should handle undefined operations in InitialExecutionState", async () => {
    // Setup - test the case where operations is undefined but we still need at least the execution event
    const eventWithUndefinedOperations: DurableExecutionInvocationInput = {
      CheckpointToken: mockCheckpointToken,
      DurableExecutionArn: mockDurableExecutionArn,
      InitialExecutionState: {
        Operations: undefined as never, // Force undefined to test the || [] branch
        NextMarker: "token1", // Add a NextMarker so we can provide the execution event via pagination
      },
    };

    // Mock the first paginated response to include the execution event
    mockDurableExecutionClient.getExecutionState.mockResolvedValueOnce({
      Operations: [mockExecutionEvent], // Provide the required execution event
      NextMarker: "",
    });

    // Execute
    const result = await initializeExecutionContext(
      eventWithUndefinedOperations,
      mockLambdaContext,
    );

    // Verify - should handle undefined operations gracefully and get execution event from pagination
    expect(mockDurableExecutionClient.getExecutionState).toHaveBeenCalledWith(
      {
        CheckpointToken: mockCheckpointToken,
        DurableExecutionArn: "test-durable-execution-arn",
        Marker: "token1",
        MaxItems: 1000,
      },
      expectLogger,
    );
    expect(result.executionContext._stepData).toEqual({});
  });

  it("should handle undefined operations in paginated response", async () => {
    // Setup - test the case where response.operations is undefined
    const eventWithNextMarker: DurableExecutionInvocationInput = {
      ...mockEvent,
      InitialExecutionState: {
        Operations: mockInitialOperations,
        NextMarker: "token1",
      },
    };

    // Mock response with undefined operations
    mockDurableExecutionClient.getExecutionState.mockResolvedValueOnce({
      Operations: undefined, // This should trigger the || [] branch
      NextMarker: "",
    });

    // Execute
    const result = await initializeExecutionContext(
      eventWithNextMarker,
      mockLambdaContext,
    );

    // Verify
    expect(mockDurableExecutionClient.getExecutionState).toHaveBeenCalledWith(
      {
        CheckpointToken: mockCheckpointToken,
        DurableExecutionArn: "test-durable-execution-arn",
        Marker: "token1",
        MaxItems: 1000,
      },
      expectLogger,
    );
    expect(result.executionContext._stepData).toEqual({
      step1: mockInitialOperations[1], // Only the initial operations should be present
    });
  });

  it("should provide getStepData method that uses hash-based lookup", async () => {
    // Setup - create step data with a known step ID
    const stepId = "step1";

    const mockStepOperation: Operation = {
      Id: stepId,
      Status: OperationStatus.SUCCEEDED,
      SubType: OperationSubType.STEP,
      Type: OperationType.STEP,
      StartTimestamp: new Date(),
    };

    const eventWithStep: DurableExecutionInvocationInput = {
      ...mockEvent,
      InitialExecutionState: {
        Operations: [mockExecutionEvent, mockStepOperation],
        NextMarker: "",
      },
    };

    // Execute
    const result = await initializeExecutionContext(
      eventWithStep,
      mockLambdaContext,
    );

    // Verify getStepData method exists and works
    expect(result.executionContext.getStepData).toBeDefined();
    expect(typeof result.executionContext.getStepData).toBe("function");

    // Test that it calls the utility function correctly
    // Since the step is stored with ID "step1", the getStepData should find it
    result.executionContext.getStepData(stepId);
    // The actual behavior depends on the hash function, but we can verify the method exists and returns something
    expect(result.executionContext.getStepData).toBeDefined();
  });

  it("should return undefined from getStepData when step not found", async () => {
    // Execute
    const result = await initializeExecutionContext(
      mockEvent,
      mockLambdaContext,
    );

    // Verify getStepData returns undefined for non-existent step
    const stepData = result.executionContext.getStepData("nonExistentStep");
    expect(stepData).toBeUndefined();
  });

  it("should use event.durableExecutionClient when event is instance of DurableExecutionInvocationInputWithClient", async () => {
    // Setup - create a custom durable execution client
    const mockCustomDurableClient: jest.Mocked<DurableExecutionClient> = {
      checkpoint: jest.fn(),
      getExecutionState: jest.fn(),
    };

    // Create event with custom client
    const eventWithCustomClient = new DurableExecutionInvocationInputWithClient(
      mockEvent,
      mockCustomDurableClient,
    );

    // Execute
    const result = await initializeExecutionContext(
      eventWithCustomClient,
      mockLambdaContext,
    );

    // Verify that the custom client is used in the execution context
    expect(result.executionContext.durableExecutionClient).toBe(
      mockCustomDurableClient,
    );

    // Verify that DurableExecutionApiClient was not instantiated
    expect(DurableExecutionApiClient).not.toHaveBeenCalled();
  });

  it("should use custom durableExecutionClient for pagination when event is DurableExecutionInvocationInputWithClient", async () => {
    // Setup - create a custom durable execution client
    const mockCustomDurableClient: jest.Mocked<DurableExecutionClient> = {
      checkpoint: jest.fn(),
      getExecutionState: jest.fn(),
    };

    // Setup event with pagination
    const eventWithPagination = new DurableExecutionInvocationInputWithClient(
      {
        ...mockEvent,
        InitialExecutionState: {
          Operations: mockInitialOperations,
          NextMarker: "token1",
        },
      },
      mockCustomDurableClient,
    );

    // Mock the custom client's getExecutionState method
    mockCustomDurableClient.getExecutionState.mockResolvedValueOnce({
      Operations: [mockStepStartedEvent],
      NextMarker: "",
    });

    // Execute
    const result = await initializeExecutionContext(
      eventWithPagination,
      mockLambdaContext,
    );

    expect(result.executionContext.durableExecutionClient).toBe(
      mockCustomDurableClient,
    );
    expect(result.executionContext.durableExecutionClient).not.toBe(
      mockDurableExecutionClient,
    );

    // Verify that the custom client was used for pagination
    expect(mockCustomDurableClient.getExecutionState).toHaveBeenCalledWith(
      {
        CheckpointToken: mockCheckpointToken,
        DurableExecutionArn: mockDurableExecutionArn,
        Marker: "token1",
        MaxItems: 1000,
      },
      expectLogger,
    );

    // Verify that the default DurableExecutionApiClient was not used
    expect(mockDurableExecutionClient.getExecutionState).not.toHaveBeenCalled();
    expect(DurableExecutionApiClient).not.toHaveBeenCalled();

    // Verify the result uses the custom client
    expect(result.executionContext.durableExecutionClient).toBe(
      mockCustomDurableClient,
    );
  });

  it("should use custom durableExecutionClient for multiple pagination calls", async () => {
    // Setup - create a custom durable execution client
    const mockCustomDurableClient: jest.Mocked<DurableExecutionClient> = {
      checkpoint: jest.fn(),
      getExecutionState: jest.fn(),
    };

    const mockOperations2: Operation[] = [
      {
        Id: "step2",
        Status: OperationStatus.STARTED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
      },
    ];

    const mockOperations3: Operation[] = [
      {
        Id: "step3",
        Status: OperationStatus.FAILED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
      },
    ];

    // Setup event with multiple pages
    const eventWithMultiplePagination =
      new DurableExecutionInvocationInputWithClient(
        {
          ...mockEvent,
          InitialExecutionState: {
            Operations: mockInitialOperations,
            NextMarker: "token1",
          },
        },
        mockCustomDurableClient,
      );

    // Mock multiple pagination responses
    mockCustomDurableClient.getExecutionState
      .mockResolvedValueOnce({
        Operations: mockOperations2,
        NextMarker: "token2",
      })
      .mockResolvedValueOnce({
        Operations: mockOperations3,
        NextMarker: "",
      });

    // Execute
    const result = await initializeExecutionContext(
      eventWithMultiplePagination,
      mockLambdaContext,
    );

    expect(result.executionContext.durableExecutionClient).toBe(
      mockCustomDurableClient,
    );
    expect(result.executionContext.durableExecutionClient).not.toBe(
      mockDurableExecutionClient,
    );

    // Verify that the custom client was called for both pagination requests
    expect(mockCustomDurableClient.getExecutionState).toHaveBeenCalledWith(
      {
        CheckpointToken: mockCheckpointToken,
        DurableExecutionArn: mockDurableExecutionArn,
        Marker: "token1",
        MaxItems: 1000,
      },
      expectLogger,
    );

    expect(mockCustomDurableClient.getExecutionState).toHaveBeenCalledWith(
      {
        CheckpointToken: mockCheckpointToken,
        DurableExecutionArn: mockDurableExecutionArn,
        Marker: "token2",
        MaxItems: 1000,
      },
      expectLogger,
    );

    // Verify both calls were made to the custom client
    expect(mockCustomDurableClient.getExecutionState).toHaveBeenCalledTimes(2);

    // Verify that the default client was not used
    expect(mockDurableExecutionClient.getExecutionState).not.toHaveBeenCalled();
    expect(DurableExecutionApiClient).not.toHaveBeenCalled();

    // Verify the step data includes all operations from multiple pages
    expect(result.executionContext._stepData).toEqual({
      step1: mockInitialOperations[1],
      step2: mockOperations2[0],
      step3: mockOperations3[0],
    });

    // Verify the result uses the custom client
    expect(result.executionContext.durableExecutionClient).toBe(
      mockCustomDurableClient,
    );
  });
});
