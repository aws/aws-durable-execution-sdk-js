/**
 * CONTRACT TEST, in part. The cases named "reports the remaining time as Infinity" guard the
 * deadline reading in rule 4 of packages/aws-durable-execution-sdk-js/AGENTS.md and
 * docs/adr/0001-operation-tracking-and-plugin-hooks.md. If a change makes one of them fail, the
 * change breaks an invariant. Do not edit, skip or delete those cases to make the change pass.
 * Change the ADR first. The other cases in this file are ordinary unit tests.
 */
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mocked,
} from "vitest";
import type { LambdaClient } from "@aws-sdk/client-lambda";
import { Operation, OperationStatus, OperationType } from "../../types/wire";
import { DurableExecutionInvocationInput, OperationSubType } from "../../types";
import { refreshLogConfig } from "../../utils/logger/logger";
import { safeStringify } from "../../utils/safe-stringify/safe-stringify";
import { initializeExecutionContext } from "./execution-context";
import { Context } from "aws-lambda";
import { DurableExecutionClient } from "../../types/durable-execution";
import { DurableExecutionApiClient } from "../../durable-execution-api-client/durable-execution-api-client";
import { DurableExecutionInvocationInputWithClient } from "../../utils/durable-execution-invocation-input/durable-execution-invocation-input";

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

  const mockDurableExecutionClient: Mocked<DurableExecutionClient> = {
    checkpoint: vi.fn(),
    getExecutionState: vi.fn(),
  };

  // The pagination tests read further pages through this client. They pass it as the
  // caller-supplied transport, so the tests control every page.
  const withMockClient = { durableExecutionClient: mockDurableExecutionClient };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // vitest.setup.ts sets DURABLE_VERBOSE_MODE to "false". The logger caches the flag, so
    // a test that changes it must restore it and refresh the cache.
    process.env.DURABLE_VERBOSE_MODE = "false";
    refreshLogConfig();
    vi.restoreAllMocks();
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
        durableExecutionClient: expect.any(DurableExecutionApiClient),
        _stepData: {},
        terminationManager: expect.any(Object),

        durableExecutionArn: mockDurableExecutionArn,
        pendingCompletions: expect.any(Set),
        getStepData: expect.any(Function),
        isOperationUpdatedBetweenInvocation: expect.any(Function),
        tenantId: mockLambdaContext.tenantId,
        requestId: mockLambdaContext.awsRequestId,
        getRemainingTimeMs: expect.any(Function),
      },
    });
  });

  it("reports remaining time from the platform context on each call", async () => {
    // This is the single point where the compute's deadline enters the SDK, so it has to
    // delegate rather than capture: the value changes over the life of the invocation.
    const remaining = vi
      .fn()
      .mockReturnValueOnce(120_000)
      .mockReturnValueOnce(90_000);
    const { executionContext } = await initializeExecutionContext(
      mockEvent,
      { ...mockLambdaContext, getRemainingTimeInMillis: remaining },
      undefined,
    );

    expect(executionContext.getRemainingTimeMs()).toBe(120_000);
    expect(executionContext.getRemainingTimeMs()).toBe(90_000);
  });

  it.each([
    ["lacks the method", undefined],
    [
      "throws",
      (): number => {
        throw new Error("no deadline");
      },
    ],
    ["returns NaN", (): number => Number.NaN],
    ["returns a non-number", (): number => "soon" as unknown as number],
  ])(
    "reports the remaining time as Infinity when the context %s",
    async (_case, getRemainingTimeInMillis) => {
      const lambdaContext = {
        ...mockLambdaContext,
        getRemainingTimeInMillis,
      } as unknown as Context;

      const { executionContext } = await initializeExecutionContext(
        mockEvent,
        lambdaContext,
        undefined,
      );

      expect(executionContext.getRemainingTimeMs()).toBe(Infinity);
    },
  );

  it("should initialize execution context in verbose mode", async () => {
    // Setup
    process.env.DURABLE_VERBOSE_MODE = "true";
    refreshLogConfig();
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    // Execute
    await initializeExecutionContext(mockEvent, mockLambdaContext);

    // Verify
    expect(debugSpy).toHaveBeenCalledWith(
      "🔵 Initializing durable function with event:",
      safeStringify(mockEvent),
    );
    expect(debugSpy).toHaveBeenCalledWith(
      "📍 Function Input:",
      safeStringify(mockEvent),
    );
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
      withMockClient,
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
      withMockClient,
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
      withMockClient,
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
      withMockClient,
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
      withMockClient,
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
      withMockClient,
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
    const mockCustomDurableClient: Mocked<DurableExecutionClient> = {
      checkpoint: vi.fn(),
      getExecutionState: vi.fn(),
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
  });

  it("should use custom durableExecutionClient for pagination when event is DurableExecutionInvocationInputWithClient", async () => {
    // Setup - create a custom durable execution client
    const mockCustomDurableClient: Mocked<DurableExecutionClient> = {
      checkpoint: vi.fn(),
      getExecutionState: vi.fn(),
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

    // Verify the result uses the custom client
    expect(result.executionContext.durableExecutionClient).toBe(
      mockCustomDurableClient,
    );
  });

  it("should use custom durableExecutionClient for multiple pagination calls", async () => {
    // Setup - create a custom durable execution client
    const mockCustomDurableClient: Mocked<DurableExecutionClient> = {
      checkpoint: vi.fn(),
      getExecutionState: vi.fn(),
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

  describe("timestamp normalization", () => {
    // The invocation event is plain JSON parsed by the runtime, so its timestamps are
    // ISO-8601 strings, whereas GetDurableExecutionState responses are deserialized by the
    // AWS SDK into Dates. Both feed the same operation history, and everything downstream
    // -- notably the instrumentation plugin surface, whose OperationInfo declares Date --
    // relies on them being normalized here. Regression guard: the otel plugin passes these
    // straight into OpenTelemetry's startTime, which rejects strings.
    const stringTimestampEvent: DurableExecutionInvocationInput = {
      CheckpointToken: mockCheckpointToken,
      DurableExecutionArn: mockDurableExecutionArn,
      InitialExecutionState: {
        Operations: [
          {
            Id: "execution-op",
            Type: OperationType.EXECUTION,
            Status: OperationStatus.STARTED,
            StartTimestamp: "2026-07-13T22:11:27.127Z",
            ExecutionDetails: { InputPayload: mockCustomerHandlerEvent },
          },
          {
            Id: "step1",
            ParentId: "execution-op",
            Name: "my-step",
            Type: OperationType.STEP,
            SubType: OperationSubType.STEP,
            Status: OperationStatus.SUCCEEDED,
            StartTimestamp: "2026-07-13T22:11:28.000Z",
            EndTimestamp: "2026-07-13T22:11:29.500Z",
            StepDetails: {
              Attempt: 1,
              NextAttemptTimestamp: "2026-07-13T22:11:35.000Z",
              Result: '"done"',
            },
          },
          {
            Id: "wait1",
            ParentId: "execution-op",
            Type: OperationType.WAIT,
            SubType: OperationSubType.WAIT,
            Status: OperationStatus.STARTED,
            StartTimestamp: "2026-07-13T22:11:30.000Z",
            WaitDetails: {
              ScheduledEndTimestamp: "2026-07-13T23:00:00.000Z",
            },
          },
        ],
        NextMarker: "",
      },
    };

    it("converts ISO-8601 event timestamps into Dates", async () => {
      const { executionContext } = await initializeExecutionContext(
        stringTimestampEvent,
        mockLambdaContext,
      );

      const step = executionContext._stepData["step1"];
      expect(step.StartTimestamp).toEqual(new Date("2026-07-13T22:11:28.000Z"));
      expect(step.EndTimestamp).toEqual(new Date("2026-07-13T22:11:29.500Z"));
      expect(step.StepDetails?.NextAttemptTimestamp).toEqual(
        new Date("2026-07-13T22:11:35.000Z"),
      );

      const wait = executionContext._stepData["wait1"];
      expect(wait.WaitDetails?.ScheduledEndTimestamp).toEqual(
        new Date("2026-07-13T23:00:00.000Z"),
      );
    });

    it("leaves every timestamp downstream as a real Date instance", async () => {
      const { executionContext } = await initializeExecutionContext(
        stringTimestampEvent,
        mockLambdaContext,
      );

      for (const operation of Object.values(executionContext._stepData)) {
        expect(operation.StartTimestamp).toBeInstanceOf(Date);
        if (operation.EndTimestamp !== undefined) {
          expect(operation.EndTimestamp).toBeInstanceOf(Date);
        }
        if (operation.StepDetails?.NextAttemptTimestamp !== undefined) {
          expect(operation.StepDetails.NextAttemptTimestamp).toBeInstanceOf(
            Date,
          );
        }
        if (operation.WaitDetails?.ScheduledEndTimestamp !== undefined) {
          expect(operation.WaitDetails.ScheduledEndTimestamp).toBeInstanceOf(
            Date,
          );
        }
      }
    });

    it("preserves the non-timestamp members of each operation", async () => {
      const { executionContext } = await initializeExecutionContext(
        stringTimestampEvent,
        mockLambdaContext,
      );

      const step = executionContext._stepData["step1"];
      expect(step.Name).toBe("my-step");
      expect(step.ParentId).toBe("execution-op");
      expect(step.Status).toBe(OperationStatus.SUCCEEDED);
      expect(step.StepDetails?.Attempt).toBe(1);
      expect(step.StepDetails?.Result).toBe('"done"');
    });
  });

  describe("transport selection", () => {
    const stubClient = (): DurableExecutionClient => ({
      getExecutionState: vi.fn().mockResolvedValue({ Operations: [] }),
      checkpoint: vi.fn().mockResolvedValue({ NewExecutionState: undefined }),
    });

    it("uses a caller-supplied durableExecutionClient instead of the Lambda transport", async () => {
      const injected = stubClient();

      const { executionContext } = await initializeExecutionContext(
        mockEvent,
        mockLambdaContext,
        { durableExecutionClient: injected },
      );

      expect(executionContext.durableExecutionClient).toBe(injected);
    });

    it("falls back to the Lambda transport when no transport is supplied", async () => {
      const { executionContext } = await initializeExecutionContext(
        mockEvent,
        mockLambdaContext,
      );

      expect(executionContext.durableExecutionClient).toBeInstanceOf(
        DurableExecutionApiClient,
      );
    });

    it("passes the deprecated client through to the Lambda transport", async () => {
      // A fake LambdaClient that records each command. The event has a second page, so
      // initialization reads it through the Lambda transport and this client.
      const send = vi.fn().mockResolvedValue({ Operations: [] });
      const lambdaClient = { send } as unknown as LambdaClient;
      const eventWithNextPage: DurableExecutionInvocationInput = {
        ...mockEvent,
        InitialExecutionState: {
          Operations: [mockExecutionEvent],
          NextMarker: "token1",
        },
      };

      const { executionContext } = await initializeExecutionContext(
        eventWithNextPage,
        mockLambdaContext,
        { client: lambdaClient },
      );

      expect(executionContext.durableExecutionClient).toBeInstanceOf(
        DurableExecutionApiClient,
      );
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0].input).toEqual({
        DurableExecutionArn: mockDurableExecutionArn,
        CheckpointToken: mockCheckpointToken,
        Marker: "token1",
        MaxItems: 1000,
      });
    });

    it("lets an event-injected transport win over configuration", async () => {
      // A harness wrapping an already-configured handler can only inject through the
      // event, so that channel has to take precedence over the handler's own config.
      const fromEvent = stubClient();
      const fromConfig = stubClient();
      const wrapped = new DurableExecutionInvocationInputWithClient(
        mockEvent,
        fromEvent,
      );

      const { executionContext } = await initializeExecutionContext(
        wrapped,
        mockLambdaContext,
        { durableExecutionClient: fromConfig },
      );

      expect(executionContext.durableExecutionClient).toBe(fromEvent);
    });
  });
});
