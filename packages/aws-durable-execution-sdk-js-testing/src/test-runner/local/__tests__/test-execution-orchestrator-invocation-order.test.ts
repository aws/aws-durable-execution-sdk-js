import { TestExecutionOrchestrator } from "../test-execution-orchestrator";
import { LocalOperationStorage } from "../operations/local-operation-storage";
import {
  createCheckpointToken,
  createExecutionId,
  createInvocationId,
} from "../../../checkpoint-server/utils/tagged-strings";
import {
  DurableExecutionInvocationOutput,
  InvocationStatus,
} from "@aws/durable-execution-sdk-js";
import {
  ErrorObject,
  Event,
  EventType,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { OperationWaitManager } from "../operations/operation-wait-manager";
import { IndexedOperations } from "../../common/indexed-operations";
import { OperationEvents } from "../../common/operations/operation-with-data";
import { FunctionStorage } from "../operations/function-storage";
import { ILocalDurableTestRunnerFactory } from "../interfaces/durable-test-runner-factory";
import { DurableApiClient } from "../../common/create-durable-api-client";
import { CheckpointApiClient } from "../api-client/checkpoint-api-client";

// Mock dependencies
jest.mock("../operations/local-operation-storage");

const mockInvoke = jest.fn();

jest.mock("../invoke-handler", () => ({
  InvokeHandler: jest.fn().mockImplementation(() => ({
    invoke: mockInvoke,
  })),
}));

/**
 * Test suite focused on verifying that addHistoryEvent is called with completeInvocation response
 * BEFORE the execution promise resolves or rejects. This ensures proper ordering for audit trails
 * and prevents race conditions where execution completes before history is recorded.
 */
describe("TestExecutionOrchestrator - Invocation History Ordering", () => {
  const mockHandlerFunction = jest.fn();
  const mockExecutionId = createExecutionId("test-execution-id");
  const mockCheckpointToken = createCheckpointToken("test-checkpoint-token");
  const mockInvocationId = createInvocationId("test-invocation-id");

  const mockOperationEvents: OperationEvents[] = [
    {
      events: [
        {
          Id: "execution-id",
          EventId: 1,
          EventType: EventType.ExecutionStarted,
        },
      ],
      operation: {
        Id: "execution-id",
        StartTimestamp: new Date(),
        Status: OperationStatus.STARTED,
        Type: OperationType.EXECUTION,
        ExecutionDetails: {},
      },
    },
  ];

  let orchestrator: TestExecutionOrchestrator;
  let mockOperationStorage: jest.Mocked<LocalOperationStorage>;
  let checkpointApi: CheckpointApiClient;
  let mockFunctionStorage: FunctionStorage;
  let mockDurableApiClient: DurableApiClient;

  // Tracking arrays for call order verification
  let callOrder: string[];
  let addHistoryEventSpy: jest.SpyInstance;
  let completeInvocationSpy: jest.SpyInstance;

  const mockInvocationCompletedEvent: Event = {
    EventType: EventType.InvocationCompleted,
    InvocationCompletedDetails: {
      RequestId: "invocation-request-id",
      StartTimestamp: new Date(),
      EndTimestamp: new Date(),
    },
  };

  const nonResolvingPromise = new Promise<never>(() => {
    // never resolve
  });

  beforeEach(() => {
    jest.clearAllMocks();
    callOrder = [];
    mockInvoke.mockReset();

    mockDurableApiClient = {
      sendCallbackFailure: jest.fn(),
      sendCallbackSuccess: jest.fn(),
      sendCallbackHeartbeat: jest.fn(),
    };

    const indexedOperations = new IndexedOperations([]);

    // Mock OperationStorage with spy on addHistoryEvent
    mockOperationStorage = new LocalOperationStorage(
      new OperationWaitManager(indexedOperations),
      indexedOperations,
      mockDurableApiClient,
      jest.fn(),
    ) as jest.Mocked<LocalOperationStorage>;

    mockOperationStorage.populateOperations = jest.fn();

    // Spy on addHistoryEvent to track when it's called
    addHistoryEventSpy = jest
      .spyOn(mockOperationStorage, "addHistoryEvent")
      .mockImplementation(() => {
        callOrder.push("addHistoryEvent");
      });

    checkpointApi = {
      startDurableExecution: jest.fn().mockResolvedValue({
        executionId: mockExecutionId,
        checkpointToken: mockCheckpointToken,
        operationEvents: mockOperationEvents,
        invocationId: mockInvocationId,
      }),
      pollCheckpointData: jest.fn().mockReturnValue(nonResolvingPromise),
      updateCheckpointData: jest.fn().mockResolvedValue(undefined),
      startInvocation: jest.fn().mockResolvedValue({
        checkpointToken: mockCheckpointToken,
        executionId: mockExecutionId,
        invocationId: mockInvocationId,
        operationEvents: [],
      }),
      completeInvocation: jest.fn().mockImplementation(() => {
        callOrder.push("completeInvocation");
        return Promise.resolve(mockInvocationCompletedEvent);
      }),
    };

    // Create a mock factory for FunctionStorage
    const mockFactory: ILocalDurableTestRunnerFactory = {
      createRunner: jest.fn().mockReturnValue({
        run: jest.fn().mockResolvedValue({
          getStatus: () => "SUCCEEDED",
          getResult: () => ({}),
        }),
      }),
    };

    mockFunctionStorage = new FunctionStorage(mockFactory);

    completeInvocationSpy = jest.spyOn(checkpointApi, "completeInvocation");

    orchestrator = new TestExecutionOrchestrator(
      mockHandlerFunction,
      mockOperationStorage,
      checkpointApi,
      mockFunctionStorage,
      {
        enabled: false,
      },
    );
  });

  describe("Successful handler execution ordering", () => {
    it("should call addHistoryEvent with completeInvocation response before execution resolves", async () => {
      // Mock handler to succeed with a result
      const mockInvocationResult: DurableExecutionInvocationOutput = {
        Status: InvocationStatus.SUCCEEDED,
        Result: JSON.stringify({ success: true }),
      };
      mockInvoke.mockResolvedValue(mockInvocationResult);

      // Track when execution promise resolves
      const executePromise = orchestrator.executeHandler({
        payload: { input: "test" },
      });

      void executePromise.then(() => {
        callOrder.push("executionResolved");
      });

      const result = await executePromise;

      // Verify execution succeeded
      expect(result.status).toBe(OperationStatus.SUCCEEDED);
      expect(result.result).toBe(JSON.stringify({ success: true }));

      // Verify call order: completeInvocation -> addHistoryEvent -> execution resolves
      expect(callOrder).toEqual([
        "completeInvocation",
        "addHistoryEvent",
        "executionResolved",
      ]);

      // Verify addHistoryEvent was called with the event from completeInvocation
      expect(addHistoryEventSpy).toHaveBeenCalledWith(
        mockInvocationCompletedEvent,
      );
      expect(completeInvocationSpy).toHaveBeenCalledWith(
        mockExecutionId,
        mockInvocationId,
        undefined, // no error for successful invocation
      );
    });

    it("should maintain ordering even with async handler that takes time to complete", async () => {
      // Mock handler with delayed resolution
      let resolveHandler: (value: DurableExecutionInvocationOutput) => void;
      const delayedHandlerPromise =
        new Promise<DurableExecutionInvocationOutput>((resolve) => {
          resolveHandler = resolve;
        });
      mockInvoke.mockReturnValue(delayedHandlerPromise);

      // Start execution
      const executePromise = orchestrator.executeHandler({
        payload: { input: "delayed-test" },
      });

      void executePromise.then(() => {
        callOrder.push("executionResolved");
      });

      // Allow some time for setup, then resolve the handler
      await new Promise((resolve) => setImmediate(resolve));

      resolveHandler!({
        Status: InvocationStatus.SUCCEEDED,
        Result: JSON.stringify({ delayed: true }),
      });

      const result = await executePromise;

      // Verify execution succeeded
      expect(result.status).toBe(OperationStatus.SUCCEEDED);

      // Verify proper ordering maintained even with async delays
      expect(callOrder).toEqual([
        "completeInvocation",
        "addHistoryEvent",
        "executionResolved",
      ]);

      expect(addHistoryEventSpy).toHaveBeenCalledWith(
        mockInvocationCompletedEvent,
      );
    });
  });

  describe("Failed handler execution ordering", () => {
    it("should call addHistoryEvent before execution resolves when handler returns failure", async () => {
      // Mock handler to return failure status
      const mockError: ErrorObject = {
        ErrorMessage: "Handler operation failed",
        ErrorType: "OperationFailure",
        StackTrace: ["at handler.js:123"],
      };

      const mockInvocationResult: DurableExecutionInvocationOutput = {
        Status: InvocationStatus.FAILED,
        Error: mockError,
      };
      mockInvoke.mockResolvedValue(mockInvocationResult);

      // Track when execution promise resolves (even with failure status)
      const executePromise = orchestrator.executeHandler({
        payload: { input: "fail-test" },
      });

      void executePromise.then(() => {
        callOrder.push("executionResolved");
      });

      const result = await executePromise;

      // Verify execution failed but promise resolved
      expect(result.status).toBe(OperationStatus.FAILED);
      expect(result.error).toEqual(mockError);

      // Verify call order: completeInvocation -> addHistoryEvent -> execution resolves
      expect(callOrder).toEqual([
        "completeInvocation",
        "addHistoryEvent",
        "executionResolved",
      ]);

      // Verify addHistoryEvent was called with error information
      expect(addHistoryEventSpy).toHaveBeenCalledWith(
        mockInvocationCompletedEvent,
      );
      expect(completeInvocationSpy).toHaveBeenCalledWith(
        mockExecutionId,
        mockInvocationId,
        mockError,
      );
    });

    it("should call addHistoryEvent before execution rejects when handler throws exception", async () => {
      // Mock handler to throw an exception
      const thrownError = new Error("Handler threw an exception");
      mockInvoke.mockRejectedValue(thrownError);

      // Track when execution promise rejects
      const executePromise = orchestrator.executeHandler({
        payload: { input: "exception-test" },
      });

      executePromise.catch(() => {
        callOrder.push("executionRejected");
      });

      await expect(executePromise).rejects.toThrow(
        "Handler threw an exception",
      );

      // Verify call order: completeInvocation -> addHistoryEvent -> execution rejects
      expect(callOrder).toEqual([
        "completeInvocation",
        "addHistoryEvent",
        "executionRejected",
      ]);

      // Verify addHistoryEvent was called with exception information
      expect(addHistoryEventSpy).toHaveBeenCalledWith(
        mockInvocationCompletedEvent,
      );
      expect(completeInvocationSpy).toHaveBeenCalledWith(
        mockExecutionId,
        mockInvocationId,
        {
          ErrorMessage: "Handler threw an exception",
          ErrorType: "Error",
          StackTrace: expect.any(Array),
        },
      );
    });

    it("should maintain ordering when handler throws after async operations", async () => {
      // Mock handler with delayed exception
      let rejectHandler: (error: Error) => void;
      const delayedExceptionPromise =
        new Promise<DurableExecutionInvocationOutput>((_, reject) => {
          rejectHandler = reject;
        });
      mockInvoke.mockReturnValue(delayedExceptionPromise);

      // Start execution
      const executePromise = orchestrator.executeHandler({
        payload: { input: "delayed-exception-test" },
      });

      executePromise.catch(() => {
        callOrder.push("executionRejected");
      });

      // Allow some time for setup, then throw the exception
      await new Promise((resolve) => setImmediate(resolve));

      const asyncError = new Error("Async handler failure");
      rejectHandler!(asyncError);

      await expect(executePromise).rejects.toThrow("Async handler failure");

      // Verify proper ordering maintained even with async exceptions
      expect(callOrder).toEqual([
        "completeInvocation",
        "addHistoryEvent",
        "executionRejected",
      ]);

      expect(addHistoryEventSpy).toHaveBeenCalledWith(
        mockInvocationCompletedEvent,
      );
      expect(completeInvocationSpy).toHaveBeenCalledWith(
        mockExecutionId,
        mockInvocationId,
        {
          ErrorMessage: "Async handler failure",
          ErrorType: "Error",
          StackTrace: expect.any(Array),
        },
      );
    });
  });

  describe("Multiple invocation scenarios", () => {
    it("should maintain history ordering across multiple handler invocations", async () => {
      // Setup for multiple invocations (simulating retries or callbacks)
      const firstInvocationId = createInvocationId("first-invocation");
      const secondInvocationId = createInvocationId("second-invocation");

      // Reset and setup for multiple invocations
      jest.spyOn(checkpointApi, "startDurableExecution").mockResolvedValue({
        executionId: mockExecutionId,
        checkpointToken: mockCheckpointToken,
        operationEvents: mockOperationEvents,
        invocationId: firstInvocationId,
      });

      jest.spyOn(checkpointApi, "startInvocation").mockResolvedValue({
        checkpointToken: createCheckpointToken("second-token"),
        executionId: mockExecutionId,
        invocationId: secondInvocationId,
        operationEvents: mockOperationEvents,
      });

      // Track multiple invocation completions
      let invocationCount = 0;
      completeInvocationSpy.mockImplementation(() => {
        invocationCount++;
        callOrder.push(`completeInvocation${invocationCount}`);
        return Promise.resolve({
          ...mockInvocationCompletedEvent,
          EventId: invocationCount,
        });
      });

      addHistoryEventSpy.mockImplementation((event: Event) => {
        const eventId = (event as Event & { EventId?: number }).EventId ?? 1;
        callOrder.push(`addHistoryEvent${eventId}`);
      });

      // First invocation returns PENDING, second returns SUCCESS
      mockInvoke
        .mockResolvedValueOnce({
          Status: InvocationStatus.PENDING,
        })
        .mockResolvedValueOnce({
          Status: InvocationStatus.SUCCEEDED,
          Result: JSON.stringify({ final: true }),
        });

      // Mock polling to trigger second invocation
      let resolvePolling: () => void;
      jest
        .spyOn(checkpointApi, "pollCheckpointData")
        .mockImplementationOnce(() => {
          return new Promise((resolve) => {
            resolvePolling = () => {
              resolve({
                operations: [
                  {
                    operation: {
                      Id: "callback-op",
                      Type: OperationType.CALLBACK,
                      Status: OperationStatus.SUCCEEDED,
                      StartTimestamp: new Date(),
                    },
                    update: {
                      Id: "callback-op",
                      Type: OperationType.CALLBACK,
                      Action: "SUCCEED" as const,
                    },
                    events: [],
                  },
                ],
              });
            };
          });
        })
        .mockReturnValue(nonResolvingPromise);

      const executePromise = orchestrator.executeHandler({
        payload: { input: "multi-invocation-test" },
      });

      void executePromise.then(() => {
        callOrder.push("executionResolved");
      });

      // Allow first invocation to process, then trigger second
      await new Promise((resolve) => setImmediate(resolve));
      resolvePolling!();

      const result = await executePromise;

      // Verify execution succeeded
      expect(result.status).toBe(OperationStatus.SUCCEEDED);

      // Verify each invocation's history was recorded before the next invocation or resolution
      expect(callOrder).toContain("completeInvocation1");
      expect(callOrder).toContain("addHistoryEvent1");
      expect(callOrder).toContain("completeInvocation2");
      expect(callOrder).toContain("addHistoryEvent2");
      expect(callOrder).toContain("executionResolved");

      // Verify that for each invocation, completeInvocation -> addHistoryEvent ordering is maintained
      const firstCompleteIndex = callOrder.indexOf("completeInvocation1");
      const firstHistoryIndex = callOrder.indexOf("addHistoryEvent1");
      const secondCompleteIndex = callOrder.indexOf("completeInvocation2");
      const secondHistoryIndex = callOrder.indexOf("addHistoryEvent2");
      const resolvedIndex = callOrder.indexOf("executionResolved");

      expect(firstCompleteIndex).toBeLessThan(firstHistoryIndex);
      expect(secondCompleteIndex).toBeLessThan(secondHistoryIndex);
      expect(secondHistoryIndex).toBeLessThan(resolvedIndex);

      // Verify both invocations were tracked
      expect(completeInvocationSpy).toHaveBeenCalledTimes(2);
      expect(addHistoryEventSpy).toHaveBeenCalledTimes(2);
    });
  });
});
