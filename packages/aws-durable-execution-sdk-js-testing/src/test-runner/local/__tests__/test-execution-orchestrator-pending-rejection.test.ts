import { TestExecutionOrchestrator } from "../test-execution-orchestrator";
import { LocalOperationStorage } from "../operations/local-operation-storage";
import {
  createCheckpointToken,
  createExecutionId,
} from "../../../checkpoint-server/utils/tagged-strings";
import { InvocationStatus } from "@aws/durable-execution-sdk-js";
import {
  Event,
  EventType,
  OperationAction,
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
 * Test suite focused on verifying that the TestExecutionOrchestrator correctly rejects
 * executions with the error "Cannot return pending status with no operations" when a handler
 * returns PENDING status but there are no pending operations or scheduled functions to justify
 * continuing execution.
 */
describe("TestExecutionOrchestrator - Pending Status Rejection", () => {
  const mockHandlerFunction = jest.fn();
  const mockExecutionId = createExecutionId("test-execution-id");
  const mockCheckpointToken = createCheckpointToken("test-checkpoint-token");

  const mockExecutionOperationEvents: OperationEvents[] = [
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
    mockInvoke.mockReset();

    mockDurableApiClient = {
      sendCallbackFailure: jest.fn(),
      sendCallbackSuccess: jest.fn(),
      sendCallbackHeartbeat: jest.fn(),
    };

    const indexedOperations = new IndexedOperations([]);

    // Mock OperationStorage
    mockOperationStorage = new LocalOperationStorage(
      new OperationWaitManager(indexedOperations),
      indexedOperations,
      mockDurableApiClient,
      jest.fn(),
    ) as jest.Mocked<LocalOperationStorage>;

    mockOperationStorage.populateOperations = jest.fn();
    mockOperationStorage.addHistoryEvent = jest.fn();

    checkpointApi = {
      startDurableExecution: jest.fn().mockResolvedValue({
        executionId: mockExecutionId,
        checkpointToken: mockCheckpointToken,
        operationEvents: mockExecutionOperationEvents,
      }),
      pollCheckpointData: jest.fn().mockReturnValue(nonResolvingPromise),
      updateCheckpointData: jest.fn().mockResolvedValue(undefined),
      startInvocation: jest.fn().mockResolvedValue({
        checkpointToken: mockCheckpointToken,
        executionId: mockExecutionId,
        operationEvents: [],
      }),
      completeInvocation: jest.fn().mockResolvedValue({
        hasDirtyOperations: false,
        event: mockInvocationCompletedEvent,
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

  describe("Single operation type pending scenarios", () => {
    it("should not reject when only invoke operation is pending", async () => {
      const invokeOperationId = "pending-invoke-op";

      // Set up complete polling sequence upfront
      jest
        .spyOn(checkpointApi, "pollCheckpointData")
        .mockResolvedValueOnce({
          operations: [
            {
              operation: {
                Id: invokeOperationId,
                StartTimestamp: new Date(),
                Status: OperationStatus.STARTED,
                Type: OperationType.CHAINED_INVOKE,
                ChainedInvokeDetails: {},
              },
              update: {
                Id: invokeOperationId,
                Type: OperationType.CHAINED_INVOKE,
                Action: OperationAction.START,
                ChainedInvokeOptions: {
                  FunctionName: "test-function",
                },
                Payload: "{}",
              },
              events: [],
            },
          ],
        })
        // Then complete the invoke operation
        .mockResolvedValueOnce({
          operations: [
            {
              operation: {
                Id: invokeOperationId,
                StartTimestamp: new Date(),
                Status: OperationStatus.SUCCEEDED,
                Type: OperationType.CHAINED_INVOKE,
                ChainedInvokeDetails: {
                  Result: JSON.stringify({ invoke: "success" }),
                },
              },
              update: {
                Id: invokeOperationId,
                Type: OperationType.CHAINED_INVOKE,
                Action: OperationAction.SUCCEED,
              },
              events: [],
            },
          ],
        })
        .mockReturnValue(nonResolvingPromise);

      // Mock function storage to complete the invoke
      jest.spyOn(mockFunctionStorage, "runHandler").mockResolvedValue({
        result: JSON.stringify({ invoke: "success" }),
        error: undefined,
      });

      // Handler returns PENDING but there's a pending invoke operation
      mockInvoke
        .mockResolvedValueOnce({
          Status: InvocationStatus.PENDING,
        })
        .mockResolvedValueOnce({
          Status: InvocationStatus.SUCCEEDED,
          Result: JSON.stringify({ success: true }),
        });

      const executePromise = orchestrator.executeHandler({
        payload: { input: "test-pending-invoke" },
      });

      const result = await executePromise;

      // Should succeed, not reject with pending status error
      expect(result.status).toBe(OperationStatus.SUCCEEDED);
      expect(result.result).toBe(JSON.stringify({ success: true }));
    });

    it("should not reject when only callback operation is pending", async () => {
      const callbackOperationId = "pending-callback-op";

      // Set up complete polling sequence upfront
      jest
        .spyOn(checkpointApi, "pollCheckpointData")
        .mockResolvedValueOnce({
          operations: [
            {
              operation: {
                Id: callbackOperationId,
                StartTimestamp: new Date(),
                Status: OperationStatus.STARTED,
                Type: OperationType.CALLBACK,
                CallbackDetails: {},
              },
              update: undefined, // No update for started callback operations
              events: [],
            },
          ],
        })
        // Then complete the callback operation
        .mockResolvedValueOnce({
          operations: [
            {
              operation: {
                Id: callbackOperationId,
                StartTimestamp: new Date(),
                Status: OperationStatus.SUCCEEDED,
                Type: OperationType.CALLBACK,
                CallbackDetails: { Result: "{}" },
              },
              update: {
                Id: callbackOperationId,
                Type: OperationType.CALLBACK,
                Action: OperationAction.SUCCEED,
              },
              events: [],
            },
          ],
        })
        .mockReturnValue(nonResolvingPromise);

      // Handler returns PENDING but there's a pending callback operation
      mockInvoke
        .mockResolvedValueOnce({
          Status: InvocationStatus.PENDING,
        })
        .mockResolvedValueOnce({
          Status: InvocationStatus.SUCCEEDED,
          Result: JSON.stringify({ success: true }),
        });

      const executePromise = orchestrator.executeHandler({
        payload: { input: "test-pending-callback" },
      });

      const result = await executePromise;

      // Should succeed, not reject with pending status error
      expect(result.status).toBe(OperationStatus.SUCCEEDED);
      expect(result.result).toBe(JSON.stringify({ success: true }));
    });

    it("should reject when handler returns PENDING with no operations", async () => {
      // Set up empty polling response - no operations
      jest
        .spyOn(checkpointApi, "pollCheckpointData")
        .mockReturnValue(nonResolvingPromise);

      // Handler returns PENDING but there are no pending operations or scheduled functions
      mockInvoke.mockResolvedValue({
        Status: InvocationStatus.PENDING,
      });

      const executePromise = orchestrator.executeHandler({
        payload: { input: "test-no-operations" },
      });

      await expect(executePromise).rejects.toEqual({
        error: {
          ErrorType: "InvalidParameterValueException",
          ErrorMessage:
            "Cannot return PENDING status with no pending operations.",
        },
        status: "FAILED",
      });
    });

    it("should not reject when there are pending operations, but dirty operations exist", async () => {
      // Set up empty polling response - no operations
      jest
        .spyOn(checkpointApi, "pollCheckpointData")
        .mockReturnValue(nonResolvingPromise);

      // Set up dirty operations
      jest.spyOn(checkpointApi, "completeInvocation").mockResolvedValue({
        hasDirtyOperations: true,
        event: mockInvocationCompletedEvent,
      });

      // Handler returns PENDING but there are no pending operations or scheduled functions
      mockInvoke
        .mockResolvedValue({
          Status: InvocationStatus.PENDING,
        })
        .mockResolvedValueOnce({
          Status: InvocationStatus.SUCCEEDED,
          Result: JSON.stringify({ success: true }),
        });

      const result = await orchestrator.executeHandler({
        payload: { input: "test-no-operations" },
      });

      expect(result.status).toBe(OperationStatus.SUCCEEDED);
      expect(result.result).toBe(JSON.stringify({ success: true }));
    });
  });

  describe("Scheduled function scenarios", () => {
    it("should not reject when scheduled functions are pending", async () => {
      const waitOperationId = "scheduled-wait-op";
      const futureTimestamp = new Date(Date.now() + 100);

      jest
        .spyOn(checkpointApi, "pollCheckpointData")
        .mockResolvedValueOnce({
          operations: [
            {
              operation: {
                Id: waitOperationId,
                StartTimestamp: new Date(),
                Status: OperationStatus.STARTED,
                Type: OperationType.WAIT,
                WaitDetails: {
                  ScheduledEndTimestamp: futureTimestamp,
                },
              },
              update: {
                Id: waitOperationId,
                Type: OperationType.WAIT,
                Action: OperationAction.START,
              },
              events: [],
            },
          ],
        })
        // Then complete the wait operation
        .mockResolvedValueOnce({
          operations: [
            {
              operation: {
                Id: waitOperationId,
                StartTimestamp: new Date(),
                Status: OperationStatus.SUCCEEDED,
                Type: OperationType.WAIT,
                WaitDetails: { ScheduledEndTimestamp: futureTimestamp },
              },
              update: {
                Id: waitOperationId,
                Type: OperationType.WAIT,
                Action: OperationAction.SUCCEED,
              },
              events: [],
            },
          ],
        })
        .mockReturnValue(nonResolvingPromise);

      // Handler returns PENDING but there's a scheduled wait operation
      mockInvoke
        .mockResolvedValueOnce({
          Status: InvocationStatus.PENDING,
        })
        .mockResolvedValueOnce({
          Status: InvocationStatus.SUCCEEDED,
          Result: JSON.stringify({ success: true }),
        });

      const executePromise = orchestrator.executeHandler({
        payload: { input: "test-scheduled-wait" },
      });

      const result = await executePromise;

      expect(result.status).toBe(OperationStatus.SUCCEEDED);
      expect(result.result).toBe(JSON.stringify({ success: true }));
    });

    it("should not immediately re-invoke when there are dirty operations but scheduled functions exist", async () => {
      // Set up empty polling response - no operations
      jest
        .spyOn(checkpointApi, "pollCheckpointData")
        .mockReturnValue(nonResolvingPromise);

      // Set up dirty operations
      jest.spyOn(checkpointApi, "completeInvocation").mockResolvedValue({
        hasDirtyOperations: true,
        event: mockInvocationCompletedEvent,
      });

      // Handler returns PENDING but there are no pending operations or scheduled functions
      mockInvoke
        .mockResolvedValue({
          Status: InvocationStatus.PENDING,
        })
        .mockResolvedValueOnce({
          Status: InvocationStatus.SUCCEEDED,
          Result: JSON.stringify({ success: true }),
        });

      const result = await orchestrator.executeHandler({
        payload: { input: "test-no-operations" },
      });

      expect(result.status).toBe(OperationStatus.SUCCEEDED);
      expect(result.result).toBe(JSON.stringify({ success: true }));
    });
  });

  describe("Operations completed scenarios", () => {
    it("should reject when operations were created but are no longer pending", async () => {
      const completedInvokeId = "completed-invoke-op";
      const completedCallbackId = "completed-callback-op";

      // Mock polling to return already completed operations
      jest
        .spyOn(checkpointApi, "pollCheckpointData")
        .mockResolvedValueOnce({
          operations: [
            {
              operation: {
                Id: completedInvokeId,
                StartTimestamp: new Date(),
                Status: OperationStatus.SUCCEEDED,
                Type: OperationType.CHAINED_INVOKE,
                ChainedInvokeDetails: { Result: "{}" },
              },
              update: {
                Id: completedInvokeId,
                Type: OperationType.CHAINED_INVOKE,
                Action: OperationAction.SUCCEED,
              },
              events: [],
            },
            {
              operation: {
                Id: completedCallbackId,
                StartTimestamp: new Date(),
                Status: OperationStatus.SUCCEEDED,
                Type: OperationType.CALLBACK,
                CallbackDetails: { Result: "{}" },
              },
              update: {
                Id: completedCallbackId,
                Type: OperationType.CALLBACK,
                Action: OperationAction.SUCCEED,
              },
              events: [],
            },
          ],
        })
        .mockReturnValue(nonResolvingPromise);

      // Handler returns PENDING, but all operations are already completed
      mockInvoke.mockResolvedValue({
        Status: InvocationStatus.PENDING,
      });

      const executePromise = orchestrator.executeHandler({
        payload: { input: "test-completed-operations" },
      });

      // The handler still returns PENDING with no actual pending work
      await expect(executePromise).rejects.toEqual({
        error: {
          ErrorType: "InvalidParameterValueException",
          ErrorMessage:
            "Cannot return PENDING status with no pending operations.",
        },
        status: "FAILED",
      });
    });

    it("should reject when callback completes between invocations leaving nothing pending", async () => {
      const callbackOperationId = "completing-callback-op";

      // First polling returns pending callback
      jest
        .spyOn(checkpointApi, "pollCheckpointData")
        .mockResolvedValueOnce({
          operations: [
            {
              operation: {
                Id: callbackOperationId,
                StartTimestamp: new Date(),
                Status: OperationStatus.STARTED,
                Type: OperationType.CALLBACK,
                CallbackDetails: {},
              },
              update: undefined,
              events: [],
            },
          ],
        })
        // Second polling returns completed callback
        .mockResolvedValueOnce({
          operations: [
            {
              operation: {
                Id: callbackOperationId,
                StartTimestamp: new Date(),
                Status: OperationStatus.SUCCEEDED,
                Type: OperationType.CALLBACK,
                CallbackDetails: { Result: "{}" },
              },
              update: {
                Id: callbackOperationId,
                Type: OperationType.CALLBACK,
                Action: OperationAction.SUCCEED,
              },
              events: [],
            },
          ],
        })
        .mockReturnValue(nonResolvingPromise);

      // Handler returns PENDING on both invocations
      mockInvoke.mockResolvedValue({
        Status: InvocationStatus.PENDING,
      });

      const executePromise = orchestrator.executeHandler({
        payload: { input: "test-completing-callback" },
      });

      // Should reject on the second invocation when callback completes but handler still returns PENDING
      await expect(executePromise).rejects.toEqual({
        error: {
          ErrorType: "InvalidParameterValueException",
          ErrorMessage:
            "Cannot return PENDING status with no pending operations.",
        },
        status: "FAILED",
      });
    });
  });

  describe("Edge cases and error conditions", () => {
    it("should handle mixed scenarios with some operations completing while others remain pending", async () => {
      const invokeOperationId = "completing-invoke-op";
      const callbackOperationId = "pending-callback-op";

      // First polling: both operations pending, then complete both
      jest
        .spyOn(checkpointApi, "pollCheckpointData")
        .mockResolvedValueOnce({
          operations: [
            {
              operation: {
                Id: invokeOperationId,
                StartTimestamp: new Date(),
                Status: OperationStatus.STARTED,
                Type: OperationType.CHAINED_INVOKE,
                ChainedInvokeDetails: {},
              },
              update: {
                Id: invokeOperationId,
                Type: OperationType.CHAINED_INVOKE,
                Action: OperationAction.START,
                ChainedInvokeOptions: {
                  FunctionName: "test-function",
                },
                Payload: "{}",
              },
              events: [],
            },
            {
              operation: {
                Id: callbackOperationId,
                StartTimestamp: new Date(),
                Status: OperationStatus.STARTED,
                Type: OperationType.CALLBACK,
                CallbackDetails: {},
              },
              update: undefined,
              events: [],
            },
          ],
        })
        // Complete callback to finish execution
        .mockResolvedValueOnce({
          operations: [
            {
              operation: {
                Id: callbackOperationId,
                StartTimestamp: new Date(),
                Status: OperationStatus.SUCCEEDED,
                Type: OperationType.CALLBACK,
                CallbackDetails: { Result: "{}" },
              },
              update: {
                Id: callbackOperationId,
                Type: OperationType.CALLBACK,
                Action: OperationAction.SUCCEED,
              },
              events: [],
            },
          ],
        })
        .mockReturnValue(nonResolvingPromise);

      // Mock function storage to complete invoke quickly
      jest.spyOn(mockFunctionStorage, "runHandler").mockResolvedValue({
        result: JSON.stringify({ invoke: "completed" }),
        error: undefined,
      });

      // Handler returns PENDING - should be valid with callback still pending
      mockInvoke
        .mockResolvedValueOnce({
          Status: InvocationStatus.PENDING,
        })
        .mockResolvedValueOnce({
          Status: InvocationStatus.SUCCEEDED,
          Result: JSON.stringify({ success: true }),
        });

      const executePromise = orchestrator.executeHandler({
        payload: { input: "test-mixed-completion" },
      });

      const result = await executePromise;

      // Should succeed - callback was still pending when first PENDING was returned
      expect(result.status).toBe(OperationStatus.SUCCEEDED);
      expect(result.result).toBe(JSON.stringify({ success: true }));
    });

    it("should properly track pending operations across multiple polling cycles", async () => {
      const firstCallbackId = "first-callback-op";
      const secondCallbackId = "second-callback-op";

      // First polling: one callback, then first completes and second starts, then second completes
      jest
        .spyOn(checkpointApi, "pollCheckpointData")
        .mockResolvedValueOnce({
          operations: [
            {
              operation: {
                Id: firstCallbackId,
                StartTimestamp: new Date(),
                Status: OperationStatus.STARTED,
                Type: OperationType.CALLBACK,
                CallbackDetails: {},
              },
              update: undefined,
              events: [],
            },
          ],
        })
        // Second polling: first completes, second starts
        .mockResolvedValueOnce({
          operations: [
            {
              operation: {
                Id: firstCallbackId,
                StartTimestamp: new Date(),
                Status: OperationStatus.SUCCEEDED,
                Type: OperationType.CALLBACK,
                CallbackDetails: { Result: "{}" },
              },
              update: {
                Id: firstCallbackId,
                Type: OperationType.CALLBACK,
                Action: OperationAction.SUCCEED,
              },
              events: [],
            },
            {
              operation: {
                Id: secondCallbackId,
                StartTimestamp: new Date(),
                Status: OperationStatus.STARTED,
                Type: OperationType.CALLBACK,
                CallbackDetails: {},
              },
              update: undefined,
              events: [],
            },
          ],
        })
        // Complete second callback
        .mockResolvedValueOnce({
          operations: [
            {
              operation: {
                Id: secondCallbackId,
                StartTimestamp: new Date(),
                Status: OperationStatus.SUCCEEDED,
                Type: OperationType.CALLBACK,
                CallbackDetails: { Result: "{}" },
              },
              update: {
                Id: secondCallbackId,
                Type: OperationType.CALLBACK,
                Action: OperationAction.SUCCEED,
              },
              events: [],
            },
          ],
        })
        .mockReturnValue(nonResolvingPromise);

      // Handler returns PENDING on both invocations (valid in both cases)
      mockInvoke
        .mockResolvedValueOnce({
          Status: InvocationStatus.PENDING,
        })
        .mockResolvedValueOnce({
          Status: InvocationStatus.SUCCEEDED,
          Result: JSON.stringify({ success: true }),
        });

      const executePromise = orchestrator.executeHandler({
        payload: { input: "test-multiple-polling-cycles" },
      });

      const result = await executePromise;

      // Should succeed - there was always at least one pending operation
      expect(result.status).toBe(OperationStatus.SUCCEEDED);
      expect(result.result).toBe(JSON.stringify({ success: true }));
    });
  });
});
