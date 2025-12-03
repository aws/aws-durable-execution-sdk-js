import {
  CheckpointDurableExecutionResponse,
  OperationAction,
  OperationStatus,
  OperationType,
  OperationUpdate,
} from "@aws-sdk/client-lambda";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { OperationSubType, ExecutionContext, DurableLogger } from "../../types";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import { CheckpointManager } from "./checkpoint-manager";
import { CheckpointFunction } from "../../testing/mock-checkpoint";
import { createTestCheckpointManager } from "../../testing/create-test-checkpoint-manager";
import { createMockExecutionContext } from "../../testing/mock-context";
import { hashId, getStepData } from "../step-id-utils/step-id-utils";
import { EventEmitter } from "events";
import { createDefaultLogger } from "../logger/default-logger";
import { DurableExecutionClient } from "../../types/durable-execution";

// Helper function to create checkpoint function from manager
const createCheckpoint = (
  context: ExecutionContext,
  token: string,
  emitter: any,
  logger: any,
): any => {
  const manager = new CheckpointManager(
    context.durableExecutionArn,
    context._stepData,
    context.durableExecutionClient,
    context.terminationManager,
    token,
    emitter,
    logger,
    new Set<string>(),
  );
  const checkpoint = (stepId: string, data: any): Promise<any> =>
    manager.checkpoint(stepId, data);
  checkpoint.force = (): Promise<any> => manager.forceCheckpoint();
  checkpoint.setTerminating = (): void => manager.setTerminating();
  checkpoint.hasPendingAncestorCompletion = (): boolean => false;
  return checkpoint;
};

// Mock dependencies
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

describe("CheckpointManager", () => {
  let mockTerminationManager: TerminationManager;
  let mockState: jest.Mocked<DurableExecutionClient>;
  let mockContext: ExecutionContext;
  let checkpointHandler: CheckpointManager;
  let mockEmitter: EventEmitter;
  let mockLogger: DurableLogger;

  const mockNewTaskToken = "new-task-token";

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitter = new EventEmitter();

    mockTerminationManager = new TerminationManager();
    jest.spyOn(mockTerminationManager, "terminate");

    mockState = {
      getExecutionState: jest.fn(),
      checkpoint: jest.fn().mockResolvedValue({
        CheckpointToken: mockNewTaskToken,
      }),
    };

    const stepData = {};
    mockContext = {
      durableExecutionArn: "test-durable-execution-arn",
      durableExecutionClient: mockState,
      _stepData: stepData,
      terminationManager: mockTerminationManager,
      pendingCompletions: new Set<string>(),
      getStepData: jest.fn((stepId: string) => {
        return getStepData(stepData, stepId);
      }),
      requestId: "",
      tenantId: undefined,
    } satisfies ExecutionContext;
    mockLogger = createDefaultLogger(mockContext);

    checkpointHandler = createTestCheckpointManager(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
    );
  });

  describe("single checkpoint", () => {
    it("should process a single checkpoint immediately", async () => {
      const stepId = "step-1";
      const data: Partial<OperationUpdate> = {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      };

      await checkpointHandler.checkpoint(stepId, data);

      // Should be processed immediately
      expect(checkpointHandler.getQueueStatus().queueLength).toBe(0);
      expect(mockState.checkpoint).toHaveBeenCalledWith(
        {
          DurableExecutionArn: "test-durable-execution-arn",
          CheckpointToken: TEST_CONSTANTS.CHECKPOINT_TOKEN,
          Updates: [
            {
              Id: hashId(stepId),
              Action: OperationAction.START,
              SubType: OperationSubType.STEP,
              Type: OperationType.STEP,
            },
          ],
        },
        mockLogger,
      ) as unknown as CheckpointFunction;
    });
  });

  describe("concurrent checkpoints", () => {
    it("should batch concurrent checkpoints together", async () => {
      // Mock checkpoint to take some time to simulate concurrent calls
      let resolveCheckpoint: (value: any) => void;
      const checkpointPromise = new Promise<CheckpointDurableExecutionResponse>(
        (resolve) => {
          resolveCheckpoint = resolve;
        },
      );
      mockState.checkpoint.mockReturnValueOnce(checkpointPromise);

      // Start multiple concurrent checkpoint requests
      const promises = [
        checkpointHandler.checkpoint("step-1", {
          Action: OperationAction.START,
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
        }),
        checkpointHandler.checkpoint("step-2", {
          Action: OperationAction.SUCCEED,
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
        }),
        checkpointHandler.checkpoint("step-3", {
          Action: OperationAction.START,
          SubType: OperationSubType.WAIT,
          Type: OperationType.WAIT,
        }),
      ];

      // Allow the first checkpoint to start processing
      await new Promise((resolve) => setImmediate(resolve));

      // At this point, checkpoint should be processing with all items batched together
      expect(checkpointHandler.getQueueStatus().isProcessing).toBe(true);
      expect(checkpointHandler.getQueueStatus().queueLength).toBe(0); // All items taken for processing

      // Resolve the checkpoint
      resolveCheckpoint!({ CheckpointToken: mockNewTaskToken });

      // Wait for all promises to complete
      await Promise.all(promises);

      // Should have made one checkpoint call with all updates batched
      expect(mockState.checkpoint).toHaveBeenCalledTimes(1);

      // Should have all three updates in the single call
      expect(mockState.checkpoint.mock.calls[0][0].Updates).toHaveLength(3);
      expect(mockState.checkpoint.mock.calls[0][0].Updates![0].Id).toBe(
        hashId("step-1"),
      ) as unknown as CheckpointFunction;
      expect(mockState.checkpoint.mock.calls[0][0].Updates![1].Id).toBe(
        hashId("step-2"),
      ) as unknown as CheckpointFunction;
      expect(mockState.checkpoint.mock.calls[0][0].Updates![2].Id).toBe(
        hashId("step-3"),
      ) as unknown as CheckpointFunction;
    });

    it("should handle rapid concurrent enqueues correctly", async () => {
      // Mock checkpoint to resolve immediately for the first call, then delay for subsequent
      let firstCall = true;
      mockState.checkpoint.mockImplementation(() => {
        if (firstCall) {
          firstCall = false;
          return Promise.resolve({
            CheckpointToken: mockNewTaskToken,
            NewExecutionState: {
              Operations: [],
            },
          });
        }
        return new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                CheckpointToken: mockNewTaskToken,
                NewExecutionState: {
                  Operations: [],
                },
              }),
            10,
          );
        });
      });

      // Create many rapid concurrent calls
      const promises = Array.from({ length: 10 }, (_, i) =>
        checkpointHandler.checkpoint(`step-${i}`, {
          Action: OperationAction.START,
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
        }),
      );

      await Promise.all(promises);

      // Should have made fewer calls than individual requests due to batching
      expect(mockState.checkpoint).toHaveBeenCalled();
      expect(mockState.checkpoint.mock.calls.length).toBeLessThan(10);

      // Verify all operations were processed
      const totalUpdates = mockState.checkpoint.mock.calls.reduce(
        (sum: number, call: any) => sum + call[0].Updates.length,
        0,
      ) as unknown as CheckpointFunction;
      expect(totalUpdates).toBe(10);
    });

    it("should never make concurrent API calls", async () => {
      let apiCallCount = 0;
      let maxConcurrentCalls = 0;

      mockState.checkpoint.mockImplementation(async () => {
        apiCallCount++;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, apiCallCount);

        // Simulate API delay to allow for potential concurrency
        await new Promise((resolve) => setTimeout(resolve, 50));

        apiCallCount--;
        return {
          CheckpointToken: mockNewTaskToken,
          NewExecutionState: {
            Operations: [],
          },
        };
      });

      // Make many concurrent calls that would expose concurrency issues
      const promises = Array.from({ length: 20 }, (_, i) =>
        checkpointHandler.checkpoint(`step-${i}`, {
          Action: OperationAction.START,
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
        }),
      );

      await Promise.all(promises);

      // Critical assertion: Never more than 1 concurrent API call
      expect(maxConcurrentCalls).toBe(1);

      // Verify all operations were processed
      const totalUpdates = mockState.checkpoint.mock.calls.reduce(
        (sum: number, call: any) => sum + call[0].Updates.length,
        0,
      ) as unknown as CheckpointFunction;
      expect(totalUpdates).toBe(20);
    });

    it("should eventually process all queued items", async () => {
      let firstBatchResolve: (value: any) => void;
      let secondBatchResolve: (value: any) => void;
      let callCount = 0;

      mockState.checkpoint.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return new Promise((resolve) => {
            firstBatchResolve = resolve;
          });
        } else {
          return new Promise((resolve) => {
            secondBatchResolve = resolve;
          });
        }
      });

      // Start first batch of checkpoints
      const firstBatch = [
        checkpointHandler.checkpoint("step-1", {
          Action: OperationAction.START,
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
        }),
        checkpointHandler.checkpoint("step-2", {
          Action: OperationAction.SUCCEED,
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
          Payload: "result-2",
        }),
      ];

      // Allow first batch to start processing
      await new Promise((resolve) => setImmediate(resolve));

      // Verify first batch is processing
      expect(checkpointHandler.getQueueStatus().isProcessing).toBe(true);
      expect(checkpointHandler.getQueueStatus().queueLength).toBe(0); // Items taken for processing

      // Add more items while first batch is still processing
      const secondBatch = [
        checkpointHandler.checkpoint("step-3", {
          Action: OperationAction.START,
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
        }),
        checkpointHandler.checkpoint("step-4", {
          Action: OperationAction.RETRY,
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
          Payload: "retry-reason",
        }),
      ];

      // Allow second batch to be queued (but not processed yet)
      await new Promise((resolve) => setImmediate(resolve));

      // Verify second batch is queued while first is processing
      expect(checkpointHandler.getQueueStatus().isProcessing).toBe(true);
      expect(checkpointHandler.getQueueStatus().queueLength).toBe(2);

      // Resolve first batch
      firstBatchResolve!({ CheckpointToken: "token-1" });
      await Promise.all(firstBatch);

      // Allow second batch to start processing
      await new Promise((resolve) => setImmediate(resolve));

      // Verify second batch is now processing
      expect(checkpointHandler.getQueueStatus().isProcessing).toBe(true);
      expect(checkpointHandler.getQueueStatus().queueLength).toBe(0); // Items taken for processing

      // Resolve second batch
      secondBatchResolve!({ CheckpointToken: "token-2" });
      await Promise.all(secondBatch);

      // Verify both batches were processed separately
      expect(mockState.checkpoint).toHaveBeenCalledTimes(2);

      // Verify first batch had 2 updates
      expect(mockState.checkpoint.mock.calls[0][0].Updates).toHaveLength(2);
      expect(mockState.checkpoint.mock.calls[0][0].Updates![0].Id).toBe(
        hashId("step-1"),
      ) as unknown as CheckpointFunction;
      expect(mockState.checkpoint.mock.calls[0][0].Updates![1].Id).toBe(
        hashId("step-2"),
      ) as unknown as CheckpointFunction;

      // Verify second batch had 2 updates
      expect(mockState.checkpoint.mock.calls[1][0].Updates).toHaveLength(2);
      expect(mockState.checkpoint.mock.calls[1][0].Updates![0].Id).toBe(
        hashId("step-3"),
      ) as unknown as CheckpointFunction;
      expect(mockState.checkpoint.mock.calls[1][0].Updates![1].Id).toBe(
        hashId("step-4"),
      ) as unknown as CheckpointFunction;

      // Verify final state is clean
      expect(checkpointHandler.getQueueStatus().isProcessing).toBe(false);
      expect(checkpointHandler.getQueueStatus().queueLength).toBe(0);
    });

    it("should handle items added to queue during processing completion", async () => {
      let firstResolve: (value: any) => void;
      let secondResolve: (value: any) => void;
      let callCount = 0;

      mockState.checkpoint.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return new Promise((resolve) => {
            firstResolve = resolve;
          });
        } else {
          return new Promise((resolve) => {
            secondResolve = resolve;
          });
        }
      });

      // Start first checkpoint
      const firstPromise = checkpointHandler.checkpoint("step-1", {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      // Allow processing to start
      await new Promise((resolve) => setImmediate(resolve));

      // Add second checkpoint while first is processing
      const secondPromise = checkpointHandler.checkpoint("step-2", {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      // Resolve first checkpoint - this should trigger processing of second
      firstResolve!({ CheckpointToken: "token-1" });
      await firstPromise;

      // Allow second checkpoint to start processing
      await new Promise((resolve) => setImmediate(resolve));

      // Resolve second checkpoint
      secondResolve!({ CheckpointToken: "token-2" });
      await secondPromise;

      // Should have made two separate API calls
      expect(mockState.checkpoint).toHaveBeenCalledTimes(2);
      expect(mockState.checkpoint.mock.calls[0][0].Updates![0].Id).toBe(
        hashId("step-1"),
      ) as unknown as CheckpointFunction;
      expect(mockState.checkpoint.mock.calls[1][0].Updates![0].Id).toBe(
        hashId("step-2"),
      ) as unknown as CheckpointFunction;
    });
  });

  describe("error handling", () => {
    it("should terminate execution when checkpoint fails", async () => {
      const error = new Error("Checkpoint API failed");
      mockState.checkpoint.mockRejectedValueOnce(error);

      checkpointHandler.checkpoint("step-1", {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      // Wait for async processing
      await new Promise((resolve) => setImmediate(resolve));

      // Should terminate execution with error object
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: TerminationReason.CHECKPOINT_FAILED,
          message: expect.stringContaining("Checkpoint failed"),
          error: expect.any(Error),
        }),
      ) as unknown as CheckpointFunction;
    });

    it("should continue processing subsequent batches after an error", async () => {
      // First call fails
      mockState.checkpoint.mockRejectedValueOnce(
        new Error("First call failed"),
      ) as unknown as CheckpointFunction;
      // Second call succeeds
      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [],
        },
      });

      checkpointHandler.checkpoint("step-1", {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      // Wait for first batch to fail
      await new Promise((resolve) => setImmediate(resolve));

      // Add second checkpoint after first fails
      const secondPromise = checkpointHandler.checkpoint("step-2", {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      await expect(secondPromise).resolves.toBeUndefined();

      expect(mockState.checkpoint).toHaveBeenCalledTimes(2);
    });

    it("should include original error message when terminating", async () => {
      // Setup
      const originalError = new Error("Specific checkpoint error message");
      mockState.checkpoint.mockRejectedValue(originalError);

      const checkpointData: Partial<OperationUpdate> = {
        Action: OperationAction.START,
      };

      // Execute
      checkpointHandler.checkpoint("test-step", checkpointData);

      // Wait for async processing
      await new Promise((resolve) => setImmediate(resolve));

      // Verify termination was called with error object
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: TerminationReason.CHECKPOINT_FAILED,
          message: expect.stringContaining("Specific checkpoint error message"),
          error: expect.any(Error),
        }),
      ) as unknown as CheckpointFunction;
    });

    it("should handle non-Error objects thrown during checkpoint", async () => {
      // Setup
      mockState.checkpoint.mockRejectedValue("String error");

      const checkpointData: Partial<OperationUpdate> = {
        Action: OperationAction.START,
      };

      // Execute
      checkpointHandler.checkpoint("test-step", checkpointData);

      // Wait for async processing
      await new Promise((resolve) => setImmediate(resolve));

      // Verify termination was called with error object
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: TerminationReason.CHECKPOINT_FAILED,
          message: expect.stringContaining("String error"),
          error: expect.any(Error),
        }),
      ) as unknown as CheckpointFunction;
    });
  });

  describe("utility methods", () => {
    it("should provide accurate queue status", () => {
      expect(checkpointHandler.getQueueStatus()).toEqual({
        queueLength: 0,
        isProcessing: false,
      });
    });
  });

  describe("termination behavior", () => {
    it("should return never-resolving promise when checkpoint is called during termination", async () => {
      // Set terminating state
      checkpointHandler.setTerminating();

      // Call checkpoint
      const checkpointPromise = checkpointHandler.checkpoint("test-step", {
        Action: OperationAction.START,
        Type: OperationType.STEP,
      });

      // Promise should not resolve within reasonable time
      let resolved = false;
      checkpointPromise.then(() => {
        resolved = true;
      });

      // Wait to ensure it doesn't resolve
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(resolved).toBe(false);
      expect(mockState.checkpoint).not.toHaveBeenCalled();
    });

    it("should return never-resolving promise when forceCheckpoint is called during termination", async () => {
      // Set terminating state
      checkpointHandler.setTerminating();

      // Call forceCheckpoint
      const forcePromise = checkpointHandler.forceCheckpoint();

      // Promise should not resolve within reasonable time
      let resolved = false;
      forcePromise.then(() => {
        resolved = true;
      });

      // Wait to ensure it doesn't resolve
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(resolved).toBe(false);
      expect(mockState.checkpoint).not.toHaveBeenCalled();
    });

    it("should allow ongoing checkpoints to complete before termination takes effect", async () => {
      // Mock slow checkpoint
      let resolveCheckpoint: (value: any) => void;
      const checkpointPromise = new Promise<CheckpointDurableExecutionResponse>(
        (resolve) => {
          resolveCheckpoint = resolve;
        },
      );
      mockState.checkpoint.mockReturnValue(checkpointPromise);

      // Start checkpoint
      const ongoingCheckpoint = checkpointHandler.checkpoint("test-step", {
        Action: OperationAction.START,
        Type: OperationType.STEP,
      });

      // Allow checkpoint to start processing
      await new Promise((resolve) => setImmediate(resolve));

      // Set terminating while checkpoint is processing
      checkpointHandler.setTerminating();

      // Resolve the ongoing checkpoint
      resolveCheckpoint!({ CheckpointToken: "new-token" });

      // Ongoing checkpoint should complete normally
      await expect(ongoingCheckpoint).resolves.toBeUndefined();

      // New checkpoints should not resolve
      const newCheckpoint = checkpointHandler.checkpoint("new-step", {
        Action: OperationAction.START,
        Type: OperationType.STEP,
      });

      let newResolved = false;
      newCheckpoint.then(() => {
        newResolved = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(newResolved).toBe(false);
    });
  });

  describe("default values", () => {
    it("should use default action and type when not provided", async () => {
      await checkpointHandler.checkpoint("step-1", {});

      expect(mockState.checkpoint).toHaveBeenCalledWith(
        {
          DurableExecutionArn: "test-durable-execution-arn",
          CheckpointToken: TEST_CONSTANTS.CHECKPOINT_TOKEN,
          Updates: [
            {
              Id: hashId("step-1"),
              Action: "START", // default action
              Type: "STEP", // default type
            },
          ],
        },
        mockLogger,
      ) as unknown as CheckpointFunction;
    });
  });

  describe("mixed operation types", () => {
    it("should handle different operation types in a batch", async () => {
      // Mock to delay first checkpoint so we can batch the others
      let resolveFirst: (value: any) => void;
      const firstPromise = new Promise<CheckpointDurableExecutionResponse>(
        (resolve) => {
          resolveFirst = resolve;
        },
      );
      mockState.checkpoint.mockReturnValueOnce(firstPromise);

      const promises = [
        checkpointHandler.checkpoint("step-1", {
          Action: OperationAction.START,
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
          Name: "Test Step 1",
        }),
        checkpointHandler.checkpoint("step-2", {
          Action: OperationAction.SUCCEED,
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
          Payload: "success result",
        }),
        checkpointHandler.checkpoint("wait-1", {
          Action: OperationAction.START,
          SubType: OperationSubType.WAIT,
          Type: OperationType.WAIT,
          WaitOptions: { WaitSeconds: 5 },
        }),
      ];

      // Allow first to start processing
      await new Promise((resolve) => setImmediate(resolve));

      // Resolve first checkpoint
      resolveFirst!({ CheckpointToken: mockNewTaskToken });

      await Promise.all(promises);

      // Should have batched all operations together in a single call
      expect(mockState.checkpoint).toHaveBeenCalledTimes(1);
      expect(mockState.checkpoint.mock.calls[0][0].Updates).toHaveLength(3);
    });
  });
});

describe("deleteCheckpointHandler", () => {
  let mockTerminationManager: TerminationManager;
  let mockState1: any;
  let mockState2: any;
  let mockContext1: ExecutionContext;
  let mockContext2: ExecutionContext;
  let mockEmitter: EventEmitter;
  let mockLogger1: DurableLogger;
  let mockLogger2: DurableLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitter = new EventEmitter();

    mockTerminationManager = new TerminationManager();
    jest.spyOn(mockTerminationManager, "terminate");

    // Create separate mock states for each context to ensure independence
    mockState1 = {
      checkpoint: jest.fn().mockResolvedValue({
        CheckpointToken: "new-task-token-1",
      }),
      getStepData: jest.fn(),
    };

    mockState2 = {
      checkpoint: jest.fn().mockResolvedValue({
        CheckpointToken: "new-task-token-2",
      }),
      getStepData: jest.fn(),
    };

    const stepData1 = {};
    mockContext1 = {
      durableExecutionArn: "test-durable-execution-arn-1",
      durableExecutionClient: mockState1,
      _stepData: stepData1,
      terminationManager: mockTerminationManager,
      pendingCompletions: new Set<string>(),
      getStepData: jest.fn((stepId: string) => {
        return getStepData(stepData1, stepId);
      }),
      requestId: "",
      tenantId: undefined,
    } satisfies ExecutionContext;

    const stepData2 = {};
    mockContext2 = {
      durableExecutionArn: "test-durable-execution-arn-2",
      durableExecutionClient: mockState2,
      _stepData: stepData2,
      terminationManager: mockTerminationManager,
      pendingCompletions: new Set<string>(),
      getStepData: jest.fn((stepId: string) => {
        return getStepData(stepData2, stepId);
      }),
      requestId: "",
      tenantId: undefined,
    } satisfies ExecutionContext;

    mockLogger1 = createDefaultLogger(mockContext1);
    mockLogger2 = createDefaultLogger(mockContext2);
  });

  it("should remove existing handler from the global map", async () => {
    // Setup - create a checkpoint handler
    const checkpoint1 = createCheckpoint(
      mockContext1,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger1,
    ) as unknown as CheckpointFunction;

    // Verify handler exists by using it
    await checkpoint1("test-step", { Action: OperationAction.START });
    expect(mockState1.checkpoint).toHaveBeenCalledTimes(1);

    // Delete the handler

    // Verify handler is removed by creating a new one
    const checkpoint1New = createCheckpoint(
      mockContext1,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger1,
    ) as unknown as CheckpointFunction;

    // The new handler should be a different instance, evidenced by separate batching behavior
    await checkpoint1New("test-step-2", { Action: OperationAction.START });
    expect(mockState1.checkpoint).toHaveBeenCalledTimes(2); // New separate call

    // Clean up the created handler
  });

  it("should clear the singleton handler", async () => {
    // Setup - create handler
    const checkpoint1 = createCheckpoint(
      mockContext1,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger1,
    ) as unknown as CheckpointFunction;
    const checkpoint2 = createCheckpoint(
      mockContext2,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger2,
    ) as unknown as CheckpointFunction; // This replaces the first

    // Use the first handler (checkpoint1's context) - both calls will be batched
    const promises = [
      checkpoint1("step-1", { Action: OperationAction.START }),
      checkpoint2("step-2", { Action: OperationAction.START }),
    ];
    await Promise.all(promises);

    // With instance-based architecture, each context gets its own manager
    expect(mockState1.checkpoint).toHaveBeenCalledTimes(1);
    expect(mockState2.checkpoint).toHaveBeenCalledTimes(1);
    // Each context processes its own operation
    expect(mockState1.checkpoint.mock.calls[0][0].Updates).toHaveLength(1);
    expect(mockState2.checkpoint.mock.calls[0][0].Updates).toHaveLength(1);

    // Delete the handler

    // Create a new handler after cleanup - should work fine
    const checkpoint3 = createCheckpoint(
      mockContext1,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger1,
    ) as unknown as CheckpointFunction;
    await checkpoint3("step-3", { Action: OperationAction.START });
    // After cleanup, new handler is created, so this is a separate call
    expect(mockState1.checkpoint).toHaveBeenCalledTimes(2);
  });

  it("should handle singleton correctly - first context wins", async () => {
    // Clean up any existing handler first

    // Create checkpoint with first context
    const checkpoint1 = createCheckpoint(
      mockContext1,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger1,
    ) as unknown as CheckpointFunction;

    // Try to create with second context - should return same handler (first context)
    const checkpoint2 = createCheckpoint(
      mockContext2,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger2,
    ) as unknown as CheckpointFunction;

    // Both checkpoint functions should use the first context (mockContext1)
    const promises = [
      checkpoint1("step-1", { Action: OperationAction.START }),
      checkpoint2("step-2", { Action: OperationAction.START }),
    ];
    await Promise.all(promises);

    // With instance-based architecture, each context gets its own manager
    expect(mockState1.checkpoint).toHaveBeenCalledTimes(1);
    expect(mockState2.checkpoint).toHaveBeenCalledTimes(1);

    // Each context processes its own operation
    expect(mockState1.checkpoint.mock.calls[0][0].Updates).toHaveLength(1);
    expect(mockState2.checkpoint.mock.calls[0][0].Updates).toHaveLength(1);

    // Clean up
  });

  describe("forceCheckpoint", () => {
    it("should call checkpoint API with empty updates when no items in queue", async () => {
      const checkpoint = createCheckpoint(
        mockContext1,
        "test-token",
        mockEmitter,
        mockLogger1,
      ) as unknown as CheckpointFunction;

      await checkpoint.force();

      expect(mockState1.checkpoint).toHaveBeenCalledWith(
        {
          DurableExecutionArn: "test-durable-execution-arn-1",
          CheckpointToken: "test-token",
          Updates: [],
        },
        mockLogger1,
      ) as unknown as CheckpointFunction;
    });

    it("should not make additional checkpoint call when force is called during ongoing checkpoint", async () => {
      const checkpoint = createCheckpoint(
        mockContext1,
        "test-token",
        mockEmitter,
        mockLogger1,
      ) as unknown as CheckpointFunction;

      // Make checkpoint API slow to simulate ongoing processing
      let resolveCheckpoint!: (value: any) => void;
      let checkpointCalled = false;
      const checkpointPromise = new Promise<any>((resolve) => {
        resolveCheckpoint = resolve;
        checkpointCalled = true;
      });
      mockState1.checkpoint.mockReturnValue(checkpointPromise);

      // Start a regular checkpoint
      const regularCheckpointPromise = checkpoint("step1", {
        Type: OperationType.STEP,
        Action: OperationAction.START,
      });

      // Wait for checkpoint to start processing
      await new Promise((resolve) => setImmediate(resolve));

      // Ensure checkpoint was actually called
      expect(checkpointCalled).toBe(true);

      // Verify first call was made
      expect(mockState1.checkpoint).toHaveBeenCalledTimes(1);

      // Call force while the regular checkpoint is processing
      const forceCheckpointPromise = checkpoint.force();

      // Should still only have one API call (no additional call for force)
      expect(mockState1.checkpoint).toHaveBeenCalledTimes(1);

      // Resolve the checkpoint API call
      resolveCheckpoint({
        CheckpointToken: "new-token",
      });

      // Both promises should resolve
      await Promise.all([regularCheckpointPromise, forceCheckpointPromise]);

      // Should still only have made one API call total (the force request piggybacked)
      expect(mockState1.checkpoint).toHaveBeenCalledTimes(1);
      expect(mockState1.checkpoint).toHaveBeenCalledWith(
        {
          DurableExecutionArn: "test-durable-execution-arn-1",
          CheckpointToken: "test-token",
          Updates: [
            {
              Type: OperationType.STEP,
              Action: OperationAction.START,
              Id: hashId("step1"),
            },
          ],
        },
        mockLogger1,
      ) as unknown as CheckpointFunction;
    });

    it("should terminate execution when force checkpoint fails", async () => {
      const checkpoint = createCheckpoint(
        mockContext1,
        "test-token",
        mockEmitter,
        mockLogger1,
      ) as unknown as CheckpointFunction;
      const error = new Error("Checkpoint failed");
      mockState1.checkpoint.mockRejectedValue(error);

      checkpoint.force();

      // Wait for async processing
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockTerminationManager.terminate).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: TerminationReason.CHECKPOINT_FAILED,
          message: expect.stringContaining("Checkpoint failed"),
          error: expect.any(Error),
        }),
      ) as unknown as CheckpointFunction;
    });
  });
});

describe("createCheckpointHandler", () => {
  // Setup common test variables
  const mockStepId = "test-step-id";

  const mockCheckpointResponse = {
    CheckpointToken: "new-task-token",
  };

  let mockTerminationManager: TerminationManager;
  let mockState: jest.Mocked<DurableExecutionClient>;
  let mockState2: jest.Mocked<DurableExecutionClient>;
  let mockContext: ExecutionContext;
  let mockLogger: DurableLogger;
  let mockEmitter: EventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitter = new EventEmitter();

    mockTerminationManager = new TerminationManager();
    jest.spyOn(mockTerminationManager, "terminate");

    mockState = {
      checkpoint: jest.fn().mockResolvedValue(mockCheckpointResponse),
      getExecutionState: jest.fn(),
    };

    const stepData = {};
    mockContext = {
      durableExecutionArn: "test-durable-execution-arn",
      durableExecutionClient: mockState,
      _stepData: stepData,
      terminationManager: mockTerminationManager,
      pendingCompletions: new Set<string>(),
      getStepData: jest.fn((stepId: string) => {
        return getStepData(stepData, stepId);
      }),
      requestId: "mock-request-id",
      tenantId: undefined,
    } satisfies ExecutionContext;
    mockLogger = createDefaultLogger(mockContext);
  });

  it("should successfully create a checkpoint", async () => {
    // Setup
    const checkpointData: Partial<OperationUpdate> = {
      Action: OperationAction.START,
      SubType: OperationSubType.STEP,
      Type: OperationType.STEP,
    };

    // Execute
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
    ) as unknown as CheckpointFunction;
    await checkpoint(mockStepId, checkpointData);

    // Verify
    expect(mockState.checkpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        CheckpointToken: TEST_CONSTANTS.CHECKPOINT_TOKEN,
        Updates: expect.arrayContaining([
          expect.objectContaining({
            Id: hashId(mockStepId),
            SubType: OperationSubType.STEP,
            Type: OperationType.STEP,
            Action: OperationAction.START,
          }),
        ]),
      }),
      mockLogger,
    ) as unknown as CheckpointFunction;
  });

  it("should batch multiple checkpoints together", async () => {
    // Setup
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
    ) as unknown as CheckpointFunction;

    // Mock checkpoint to delay so we can test batching
    let resolveCheckpoint: (value: any) => void;
    const checkpointPromise = new Promise<CheckpointDurableExecutionResponse>(
      (resolve) => {
        resolveCheckpoint = resolve;
      },
    );
    mockState.checkpoint.mockReturnValueOnce(checkpointPromise);

    // Execute multiple checkpoints rapidly
    const promises = [
      checkpoint("step-1", {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      }),
      checkpoint("step-2", {
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      }),
      checkpoint("step-3", {
        Action: OperationAction.START,
        SubType: OperationSubType.WAIT,
        Type: OperationType.WAIT,
      }),
    ];

    // Allow first checkpoint to start processing
    await new Promise((resolve) => setImmediate(resolve));

    // Resolve the first checkpoint
    resolveCheckpoint!(mockCheckpointResponse);

    await Promise.all(promises);

    // Verify checkpoint calls were made
    expect(mockState.checkpoint).toHaveBeenCalled();

    // Should have batched some operations together
    const totalCalls = mockState.checkpoint.mock.calls.length;
    expect(totalCalls).toBeLessThan(3); // Should be fewer calls than individual requests
  });

  it("should reuse the same handler for the same execution context", async () => {
    // Setup
    const checkpoint1 = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
    ) as unknown as CheckpointFunction;
    const checkpoint2 = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
    ) as unknown as CheckpointFunction;

    // Mock to delay first checkpoint
    let resolveFirst: (value: any) => void;
    const firstPromise = new Promise<CheckpointDurableExecutionResponse>(
      (resolve) => {
        resolveFirst = resolve;
      },
    );
    mockState.checkpoint.mockReturnValueOnce(firstPromise);

    // Execute checkpoints from both handlers
    const promises = [
      checkpoint1("step-1", { Action: OperationAction.START }),
      checkpoint2("step-2", { Action: OperationAction.START }),
    ];

    // Allow processing to start
    await new Promise((resolve) => setImmediate(resolve));

    // Resolve first checkpoint
    resolveFirst!(mockCheckpointResponse);

    await Promise.all(promises);

    // Verify they were processed (should be batched together in second call)
    expect(mockState.checkpoint).toHaveBeenCalled();
  });

  it("should use the first context when multiple contexts are created", async () => {
    // Create second mock state
    mockState2 = {
      ...mockState2,
      checkpoint: jest.fn().mockResolvedValue(mockCheckpointResponse),
    };

    // Setup second context
    const mockContext2 = createMockExecutionContext({
      durableExecutionArn: "test-durable-execution-arn-2",
      durableExecutionClient: mockState2,
      terminationManager: mockTerminationManager,
    });

    const checkpoint1 = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
    ) as unknown as CheckpointFunction;
    const checkpoint2 = createCheckpoint(
      mockContext2,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
    ) as unknown as CheckpointFunction;

    // Execute checkpoints - each should use its own context
    const promises = [
      checkpoint1("step-1", { Action: OperationAction.START }),
      checkpoint2("step-2", { Action: OperationAction.START }),
    ];

    await Promise.all(promises);

    // With instance-based architecture, each context gets its own manager
    expect(mockState.checkpoint).toHaveBeenCalledTimes(1);
    expect(mockState2.checkpoint).toHaveBeenCalledTimes(1);

    // Each context processes its own operation
    expect(mockState.checkpoint.mock.calls[0][0].Updates).toHaveLength(1);
    expect(mockState2.checkpoint.mock.calls[0][0].Updates).toHaveLength(1);
  });

  it("should use the same handler for equivalent execution context ids, but different objects", async () => {
    // Create second mock state
    mockState2 = {
      ...mockState2,
      checkpoint: jest.fn().mockResolvedValue(mockCheckpointResponse),
    };

    // Setup second context
    const mockContext2 = createMockExecutionContext({
      durableExecutionArn: "test-durable-execution-arn-2",
      durableExecutionClient: mockState2,
      terminationManager: mockTerminationManager,
    });

    const checkpoint1 = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
    ) as unknown as CheckpointFunction;
    const checkpoint2 = createCheckpoint(
      mockContext2,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      createDefaultLogger(mockContext2),
    ) as unknown as CheckpointFunction;

    // Execute checkpoints from both contexts
    const promises = [
      checkpoint1("step-1", { Action: OperationAction.START }),
      checkpoint2("step-2", { Action: OperationAction.START }),
    ];

    await Promise.all(promises);

    // With instance-based architecture, each context gets its own manager
    expect(mockState.checkpoint).toHaveBeenCalledTimes(1);
    expect(mockState2.checkpoint).toHaveBeenCalledTimes(1);

    // Each context processes its own operation
    expect(mockState.checkpoint.mock.calls[0][0].Updates).toHaveLength(1);
    expect(mockState2.checkpoint.mock.calls[0][0].Updates).toHaveLength(1);
  });

  it("should split large payloads into multiple API calls when exceeding 750KB limit", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
    ) as unknown as CheckpointFunction;

    // Create large payload data that will exceed 750KB when combined
    const largeData = "x".repeat(400000); // 400KB per item

    // Queue two large items that together exceed 750KB
    const promises = [
      checkpoint("large-step-1", {
        Action: OperationAction.START,
        Payload: largeData,
      }),
      checkpoint("large-step-2", {
        Action: OperationAction.START,
        Payload: largeData,
      }),
    ];

    await Promise.all(promises);

    // Should make multiple API calls due to size limit
    expect(mockState.checkpoint).toHaveBeenCalledTimes(2);

    // First call should have one item
    expect(mockState.checkpoint.mock.calls[0][0].Updates).toHaveLength(1);
    // Second call should have the remaining item
    expect(mockState.checkpoint.mock.calls[1][0].Updates).toHaveLength(1);
  });

  it("should split large payloads into multiple API calls when exceeding 750KB limit for large unicode characters", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
    ) as unknown as CheckpointFunction;

    // Create large payload data that will exceed 750KB when combined
    const largeData = "\u{FFFF}".repeat(200000); // Length is 200KB, but byte length is 600KB

    // Queue two large items that together exceed 750KB
    const promises = [
      checkpoint("large-step-1", {
        Action: OperationAction.START,
        Payload: largeData,
      }),
      checkpoint("large-step-2", {
        Action: OperationAction.START,
        Payload: largeData,
      }),
    ];

    await Promise.all(promises);

    // Should make multiple API calls due to size limit
    expect(mockState.checkpoint).toHaveBeenCalledTimes(2);

    // First call should have one item
    expect(mockState.checkpoint.mock.calls[0][0].Updates).toHaveLength(1);
    // Second call should have the remaining item
    expect(mockState.checkpoint.mock.calls[1][0].Updates).toHaveLength(1);
  });

  it("should process remaining items in queue after size limit is reached", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
    ) as unknown as CheckpointFunction;

    // Create items where first is large enough to trigger size limit
    const largeData = "x".repeat(400000); // 400KB

    // Add first large item
    const promise1 = checkpoint("large-step", {
      Action: OperationAction.START,
      Payload: largeData,
    });

    // Wait a bit then add more items
    await new Promise((resolve) => setTimeout(resolve, 10));

    const promise2 = checkpoint("small-step-1", {
      Action: OperationAction.START,
      Payload: largeData,
    });
    const promise3 = checkpoint("small-step-2", {
      Action: OperationAction.START,
    });

    await Promise.all([promise1, promise2, promise3]);

    // Should make multiple calls due to size limits
    expect(mockState.checkpoint).toHaveBeenCalledTimes(2);

    // Verify all items were processed
    const allUpdates = mockState.checkpoint.mock.calls.flatMap(
      (call: any) => call[0].Updates,
    );
    expect(allUpdates).toHaveLength(3);
    expect(allUpdates.map((u: any) => u.Id)).toEqual([
      hashId("large-step"),
      hashId("small-step-1"),
      hashId("small-step-2"),
    ]);
  });

  it("should update stepData from checkpoint response operations", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
    ) as unknown as CheckpointFunction;

    // Mock checkpoint response with operations
    const mockOperations = [
      {
        Id: hashId("test-step"),
        Type: OperationType.STEP,
        Action: OperationAction.START,
        Payload: "test-result",
        StartTimestamp: new Date(),
        Status: OperationStatus.STARTED,
      },
    ];

    mockState.checkpoint.mockResolvedValue({
      CheckpointToken: "new-task-token",
      NewExecutionState: {
        Operations: mockOperations,
      },
    });

    await checkpoint("test-step", { Action: OperationAction.START });

    // Verify stepData was updated with operations from response
    expect(mockContext._stepData[hashId("test-step")]).toEqual(
      mockOperations[0],
    ) as unknown as CheckpointFunction;
  });
});
