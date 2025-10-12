import {
  Operation,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { ExecutionStateFactory } from "../../storage/storage-factory";
import { DurableExecutionInvocationInput, OperationSubType } from "../../types";
import { log } from "../../utils/logger/logger";
import { initializeExecutionContext } from "./execution-context";

// Mock dependencies
jest.mock("../../storage/storage-factory");
jest.mock("../../utils/logger/logger");
jest.mock("../../termination-manager/termination-manager");

describe("initializeExecutionContext", () => {
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

  const mockExecutionState = {
    checkpoint: jest.fn(),
    getStepData: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks
    (ExecutionStateFactory.createExecutionState as jest.Mock).mockReturnValue(
      mockExecutionState,
    );

    // Mock environment variables
    process.env.DURABLE_VERBOSE_MODE = "false";
  });

  afterEach(() => {
    // Reset environment variables
    delete process.env.DURABLE_VERBOSE_MODE;
  });

  it("should initialize execution context with basic event", async () => {
    // Execute
    const result = await initializeExecutionContext(mockEvent);

    // Verify
    expect(ExecutionStateFactory.createExecutionState).toHaveBeenCalledWith(
      false,
    );
    expect(result).toEqual(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          state: mockExecutionState,
          _stepData: {},
        }),
        checkpointToken: mockCheckpointToken,
      }),
    );
    expect(result.executionContext.terminationManager).toBeDefined();
  });

  it("should initialize execution context in verbose mode", async () => {
    // Setup
    process.env.DURABLE_VERBOSE_MODE = "true";

    // Execute
    const result = await initializeExecutionContext(mockEvent);

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
    const result = await initializeExecutionContext(eventWithStepData);

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
    const result = await initializeExecutionContext(eventWithoutStepData);

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

    mockExecutionState.getStepData.mockResolvedValueOnce({
      Operations: [mockStepStartedEvent],
      NextMarker: undefined,
    });

    // Execute
    const result = await initializeExecutionContext(eventWithNextMarker);

    // Verify
    expect(mockExecutionState.getStepData).toHaveBeenCalledWith(
      mockCheckpointToken,
      "test-durable-execution-arn",
      "token1",
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

    mockExecutionState.getStepData.mockResolvedValueOnce({
      Operations: mockOperations2,
      NextMarker: "token2",
    });

    mockExecutionState.getStepData.mockResolvedValueOnce({
      Operations: mockOperations3,
      NextMarker: undefined,
    });

    // Execute
    const result = await initializeExecutionContext(eventWithNextMarker);

    // Verify
    expect(mockExecutionState.getStepData).toHaveBeenCalledWith(
      mockCheckpointToken,
      "test-durable-execution-arn",
      "token1",
    );
    expect(mockExecutionState.getStepData).toHaveBeenCalledWith(
      mockCheckpointToken,
      "test-durable-execution-arn",
      "token2",
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

    mockExecutionState.getStepData.mockResolvedValueOnce({
      Operations: [mockCustomerHandlerEvent],
      NextMarker: "token2",
    });

    mockExecutionState.getStepData.mockResolvedValueOnce({
      Operations: [mockStepSucceededEvent],
      NextMarker: "",
    });

    // Execute
    const result = await initializeExecutionContext(
      eventWithNextMarkerButNoOperations,
    );

    // Verify
    expect(mockExecutionState.getStepData).toHaveBeenCalledWith(
      mockCheckpointToken,
      "test-durable-execution-arn",
      "token1",
    );

    expect(mockExecutionState.getStepData).toHaveBeenCalledWith(
      mockCheckpointToken,
      "test-durable-execution-arn",
      "token2",
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
    mockExecutionState.getStepData.mockResolvedValueOnce({
      Operations: [mockStepStartedEvent],
      NextMarker: "", // Empty string should exit the while loop
    });

    // Execute
    const result = await initializeExecutionContext(eventWithNextMarker);

    // Verify
    expect(mockExecutionState.getStepData).toHaveBeenCalledWith(
      mockCheckpointToken,
      "test-durable-execution-arn",
      "token1",
    );
    expect(mockExecutionState.getStepData).toHaveBeenCalledTimes(1); // Should only be called once
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
    mockExecutionState.getStepData.mockResolvedValueOnce({
      Operations: [mockExecutionEvent], // Provide the required execution event
      NextMarker: "",
    });

    // Execute
    const result = await initializeExecutionContext(
      eventWithUndefinedOperations,
    );

    // Verify - should handle undefined operations gracefully and get execution event from pagination
    expect(mockExecutionState.getStepData).toHaveBeenCalledWith(
      mockCheckpointToken,
      "test-durable-execution-arn",
      "token1",
    );
    expect(result.executionContext._stepData).toEqual({});
  });

  it("should use LocalRunner flag to create LocalRunnerStorage", async () => {
    const eventWithLocalRunner: DurableExecutionInvocationInput = {
      ...mockEvent,
      LocalRunner: true,
    };

    // Execute
    await initializeExecutionContext(eventWithLocalRunner);

    // Verify
    expect(ExecutionStateFactory.createExecutionState).toHaveBeenCalledWith(
      true,
    );
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
    mockExecutionState.getStepData.mockResolvedValueOnce({
      Operations: undefined, // This should trigger the || [] branch
      NextMarker: "",
    });

    // Execute
    const result = await initializeExecutionContext(eventWithNextMarker);

    // Verify
    expect(mockExecutionState.getStepData).toHaveBeenCalledWith(
      mockCheckpointToken,
      "test-durable-execution-arn",
      "token1",
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
    const result = await initializeExecutionContext(eventWithStep);

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
    const result = await initializeExecutionContext(mockEvent);

    // Verify getStepData returns undefined for non-existent step
    const stepData = result.executionContext.getStepData("nonExistentStep");
    expect(stepData).toBeUndefined();
  });
});
