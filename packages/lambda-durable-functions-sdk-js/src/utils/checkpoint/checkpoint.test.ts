import {
  OperationAction,
  OperationType,
  OperationUpdate,
} from "@amzn/dex-internal-sdk";
import { CheckpointFailedError } from "../../errors/checkpoint-errors/checkpoint-errors";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { OperationSubType, ExecutionContext } from "../../types";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import {
  CheckpointHandler,
  createCheckpoint,
  deleteCheckpoint,
} from "./checkpoint";
import { randomUUID } from "crypto";
import { hashId, getStepData } from "../step-id-utils/step-id-utils";

// Mock dependencies
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

describe("CheckpointHandler", () => {
  let mockTerminationManager: TerminationManager;
  let mockState: any;
  let mockContext: ExecutionContext;
  let checkpointHandler: CheckpointHandler;

  const mockTaskToken = TEST_CONSTANTS.CHECKPOINT_TOKEN;
  const mockNewTaskToken = "new-task-token";

  beforeEach(() => {
    jest.clearAllMocks();

    mockTerminationManager = new TerminationManager();
    jest.spyOn(mockTerminationManager, "terminate");

    mockState = {
      checkpoint: jest.fn().mockResolvedValue({
        CheckpointToken: mockNewTaskToken,
      }),
    };

    const stepData = {};
    mockContext = {
      executionContextId: randomUUID(),
      durableExecutionArn: "test-durable-execution-arn",
      state: mockState,
      _stepData: stepData,
      terminationManager: mockTerminationManager,
      isVerbose: false,
      isLocalMode: false,
      customerHandlerEvent: {},
      getStepData: jest.fn((stepId: string) => {
        return getStepData(stepData, stepId);
      }),
    } satisfies ExecutionContext;

    checkpointHandler = new CheckpointHandler(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
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

      const result = await checkpointHandler.checkpoint(stepId, data);

      // Should be processed immediately
      expect(checkpointHandler.getQueueStatus().queueLength).toBe(0);
      expect(mockState.checkpoint).toHaveBeenCalledWith(
        TEST_CONSTANTS.CHECKPOINT_TOKEN,
        {
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
      );
    });
  });

  describe("concurrent checkpoints", () => {
    it("should batch concurrent checkpoints together", async () => {
      // Mock checkpoint to take some time to simulate concurrent calls
      let resolveCheckpoint: (value: any) => void;
      const checkpointPromise = new Promise((resolve) => {
        resolveCheckpoint = resolve;
      });
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
      expect(mockState.checkpoint.mock.calls[0][1].Updates).toHaveLength(3);
      expect(mockState.checkpoint.mock.calls[0][1].Updates[0].Id).toBe(
        hashId("step-1"),
      );
      expect(mockState.checkpoint.mock.calls[0][1].Updates[1].Id).toBe(
        hashId("step-2"),
      );
      expect(mockState.checkpoint.mock.calls[0][1].Updates[2].Id).toBe(
        hashId("step-3"),
      );
    });

    it("should handle rapid concurrent enqueues correctly", async () => {
      // Mock checkpoint to resolve immediately for the first call, then delay for subsequent
      let firstCall = true;
      mockState.checkpoint.mockImplementation(() => {
        if (firstCall) {
          firstCall = false;
          return Promise.resolve({ CheckpointToken: mockNewTaskToken });
        }
        return new Promise((resolve) => {
          setTimeout(() => resolve({ CheckpointToken: mockNewTaskToken }), 10);
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
        (sum: number, call: any) => sum + call[1].Updates.length,
        0,
      );
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
        return { CheckpointToken: mockNewTaskToken };
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
        (sum: number, call: any) => sum + call[1].Updates.length,
        0,
      );
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
      expect(mockState.checkpoint.mock.calls[0][1].Updates).toHaveLength(2);
      expect(mockState.checkpoint.mock.calls[0][1].Updates[0].Id).toBe(
        hashId("step-1"),
      );
      expect(mockState.checkpoint.mock.calls[0][1].Updates[1].Id).toBe(
        hashId("step-2"),
      );

      // Verify second batch had 2 updates
      expect(mockState.checkpoint.mock.calls[1][1].Updates).toHaveLength(2);
      expect(mockState.checkpoint.mock.calls[1][1].Updates[0].Id).toBe(
        hashId("step-3"),
      );
      expect(mockState.checkpoint.mock.calls[1][1].Updates[1].Id).toBe(
        hashId("step-4"),
      );

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
      expect(mockState.checkpoint.mock.calls[0][1].Updates[0].Id).toBe(
        hashId("step-1"),
      );
      expect(mockState.checkpoint.mock.calls[1][1].Updates[0].Id).toBe(
        hashId("step-2"),
      );
    });
  });

  describe("error handling", () => {
    it("should reject all promises in batch when checkpoint fails", async () => {
      const error = new Error("Checkpoint API failed");
      mockState.checkpoint.mockRejectedValueOnce(error);

      const promise = checkpointHandler.checkpoint("step-1", {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      // Promise should reject with CheckpointFailedError
      await expect(promise).rejects.toThrow(CheckpointFailedError);

      // Should terminate execution
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CHECKPOINT_FAILED,
        message: "Checkpoint batch failed: Checkpoint API failed",
      });
    });

    it("should continue processing subsequent batches after an error", async () => {
      // First call fails
      mockState.checkpoint.mockRejectedValueOnce(
        new Error("First call failed"),
      );
      // Second call succeeds
      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
      });

      const firstPromise = checkpointHandler.checkpoint("step-1", {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      await expect(firstPromise).rejects.toThrow(CheckpointFailedError);

      // Add second checkpoint after first fails
      const secondPromise = checkpointHandler.checkpoint("step-2", {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      await expect(secondPromise).resolves.toBeUndefined();

      expect(mockState.checkpoint).toHaveBeenCalledTimes(2);
    });

    it("should include original error message in CheckpointFailedError", async () => {
      // Setup
      const originalError = new Error("Specific checkpoint error message");
      mockState.checkpoint.mockRejectedValue(originalError);

      const checkpointData: Partial<OperationUpdate> = {
        Action: OperationAction.START,
      };

      // Execute
      const promise = checkpointHandler.checkpoint("test-step", checkpointData);

      try {
        await promise;
        fail("Expected checkpoint to throw an error");
      } catch (error) {
        // Verify
        expect(error).toBeInstanceOf(CheckpointFailedError);
        expect((error as Error).message).toBe(
          "[Unrecoverable Invocation] Checkpoint batch failed: Specific checkpoint error message",
        );
      }
    });

    it("should handle non-Error objects thrown during checkpoint", async () => {
      // Setup
      mockState.checkpoint.mockRejectedValue("String error");

      const checkpointData: Partial<OperationUpdate> = {
        Action: OperationAction.START,
      };

      // Execute
      const promise = checkpointHandler.checkpoint("test-step", checkpointData);

      try {
        await promise;
        fail("Expected checkpoint to throw an error");
      } catch (error) {
        // Verify
        expect(error).toBeInstanceOf(CheckpointFailedError);
        expect((error as Error).message).toBe(
          "[Unrecoverable Invocation] Checkpoint batch failed: String error",
        );
      }
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

  describe("default values", () => {
    it("should use default action and type when not provided", async () => {
      await checkpointHandler.checkpoint("step-1", {});

      expect(mockState.checkpoint).toHaveBeenCalledWith(
        TEST_CONSTANTS.CHECKPOINT_TOKEN,
        {
          CheckpointToken: TEST_CONSTANTS.CHECKPOINT_TOKEN,
          Updates: [
            {
              Id: hashId("step-1"),
              Action: "START", // default action
              Type: "STEP", // default type
            },
          ],
        },
      );
    });
  });

  describe("mixed operation types", () => {
    it("should handle different operation types in a batch", async () => {
      // Mock to delay first checkpoint so we can batch the others
      let resolveFirst: (value: any) => void;
      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });
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
      expect(mockState.checkpoint.mock.calls[0][1].Updates).toHaveLength(3);
    });
  });
});

describe("deleteCheckpointHandler", () => {
  let mockTerminationManager: TerminationManager;
  let mockState1: any;
  let mockState2: any;
  let mockContext1: ExecutionContext;
  let mockContext2: ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    deleteCheckpoint(); // Clear singleton before each test

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
      executionContextId: "execution-context-1",
      durableExecutionArn: "test-durable-execution-arn-1",
      state: mockState1,
      _stepData: stepData1,
      terminationManager: mockTerminationManager,
      isLocalMode: false,
      isVerbose: false,
      customerHandlerEvent: {},
      getStepData: jest.fn((stepId: string) => {
        return getStepData(stepData1, stepId);
      }),
    } satisfies ExecutionContext;

    const stepData2 = {};
    mockContext2 = {
      executionContextId: "execution-context-2",
      durableExecutionArn: "test-durable-execution-arn-2",
      state: mockState2,
      _stepData: stepData2,
      terminationManager: mockTerminationManager,
      isLocalMode: false,
      isVerbose: false,
      customerHandlerEvent: {},
      getStepData: jest.fn((stepId: string) => {
        return getStepData(stepData2, stepId);
      }),
    } satisfies ExecutionContext;
  });

  it("should remove existing handler from the global map", async () => {
    // Setup - create a checkpoint handler
    const checkpoint1 = createCheckpoint(
      mockContext1,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );

    // Verify handler exists by using it
    await checkpoint1("test-step", { Action: OperationAction.START });
    expect(mockState1.checkpoint).toHaveBeenCalledTimes(1);

    // Delete the handler
    deleteCheckpoint();

    // Verify handler is removed by creating a new one
    const checkpoint1New = createCheckpoint(
      mockContext1,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );

    // The new handler should be a different instance, evidenced by separate batching behavior
    await checkpoint1New("test-step-2", { Action: OperationAction.START });
    expect(mockState1.checkpoint).toHaveBeenCalledTimes(2); // New separate call

    // Clean up the created handler
    deleteCheckpoint();
  });

  it("should clear the singleton handler", async () => {
    // Setup - create handler
    const checkpoint1 = createCheckpoint(
      mockContext1,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );
    const checkpoint2 = createCheckpoint(
      mockContext2,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    ); // This replaces the first

    // Use the first handler (checkpoint1's context) - both calls will be batched
    const promises = [
      checkpoint1("step-1", { Action: OperationAction.START }),
      checkpoint2("step-2", { Action: OperationAction.START }),
    ];
    await Promise.all(promises);

    // With singleton, first context is used and both calls are batched together
    expect(mockState1.checkpoint).toHaveBeenCalledTimes(1);
    expect(mockState2.checkpoint).toHaveBeenCalledTimes(0);
    // Verify both operations were batched together
    const calls = mockState1.checkpoint.mock.calls;
    expect(calls[0][1].Updates).toHaveLength(2);

    // Delete the handler
    deleteCheckpoint(); // Context doesn't matter for singleton

    // Create a new handler after cleanup - should work fine
    const checkpoint3 = createCheckpoint(
      mockContext1,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );
    await checkpoint3("step-3", { Action: OperationAction.START });
    // After cleanup, new handler is created, so this is a separate call
    expect(mockState1.checkpoint).toHaveBeenCalledTimes(2);
  });

  it("should handle singleton correctly - first context wins", async () => {
    // Clean up any existing handler first
    deleteCheckpoint();

    // Create checkpoint with first context
    const checkpoint1 = createCheckpoint(
      mockContext1,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );

    // Try to create with second context - should return same handler (first context)
    const checkpoint2 = createCheckpoint(
      mockContext2,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );

    // Both checkpoint functions should use the first context (mockContext1)
    const promises = [
      checkpoint1("step-1", { Action: OperationAction.START }),
      checkpoint2("step-2", { Action: OperationAction.START }),
    ];
    await Promise.all(promises);

    // Only mockState1 should have been called (first context wins)
    expect(mockState1.checkpoint).toHaveBeenCalledTimes(1);
    expect(mockState2.checkpoint).toHaveBeenCalledTimes(0);

    // Verify both operations were batched together
    const calls = mockState1.checkpoint.mock.calls;
    expect(calls[0][1].Updates).toHaveLength(2);

    // Clean up
    deleteCheckpoint();
  });

  describe("forceCheckpoint", () => {
    it("should call checkpoint API with empty updates when no items in queue", async () => {
      const checkpoint = createCheckpoint(mockContext1, "test-token");

      await checkpoint.force();

      expect(mockState1.checkpoint).toHaveBeenCalledWith("test-token", {
        CheckpointToken: "test-token",
        Updates: [],
      });
    });

    it("should not make additional checkpoint call when force is called during ongoing checkpoint", async () => {
      const checkpoint = createCheckpoint(mockContext1, "test-token");

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
      expect(mockState1.checkpoint).toHaveBeenCalledWith("test-token", {
        CheckpointToken: "test-token",
        Updates: [
          {
            Type: OperationType.STEP,
            Action: OperationAction.START,
            Id: hashId("step1"),
          },
        ],
      });
    });

    it("should reject force checkpoint promises when checkpoint fails", async () => {
      const checkpoint = createCheckpoint(mockContext1, "test-token");
      const error = new Error("Checkpoint failed");
      mockState1.checkpoint.mockRejectedValue(error);

      await expect(checkpoint.force()).rejects.toThrow(CheckpointFailedError);
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CHECKPOINT_FAILED,
        message: "Checkpoint batch failed: Checkpoint failed",
      });
    });
  });
});

describe("createCheckpointHandler", () => {
  // Setup common test variables
  const mockStepId = "test-step-id";
  const mockTaskToken = TEST_CONSTANTS.CHECKPOINT_TOKEN;

  const mockCheckpointResponse = {
    CheckpointToken: "new-task-token",
  };

  let mockTerminationManager: TerminationManager;
  let mockState: any;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    deleteCheckpoint(); // Clear singleton before each test

    mockTerminationManager = new TerminationManager();
    jest.spyOn(mockTerminationManager, "terminate");

    mockState = {
      checkpoint: jest.fn().mockResolvedValue(mockCheckpointResponse),
      getStepData: jest.fn(),
    };

    const stepData = {};
    mockContext = {
      executionContextId: randomUUID(),
      durableExecutionArn: "test-durable-execution-arn",
      state: mockState,
      _stepData: stepData,
      terminationManager: mockTerminationManager,
      isLocalMode: false,
      isVerbose: false,
      customerHandlerEvent: {},
      getStepData: jest.fn((stepId: string) => {
        return getStepData(stepData, stepId);
      }),
    } satisfies ExecutionContext;
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
    );
    const result = await checkpoint(mockStepId, checkpointData);

    // Verify
    expect(mockState.checkpoint).toHaveBeenCalledWith(
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
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
    );
  });

  it("should batch multiple checkpoints together", async () => {
    deleteCheckpoint(); // Clean up singleton
    // Setup
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );

    // Mock checkpoint to delay so we can test batching
    let resolveCheckpoint: (value: any) => void;
    const checkpointPromise = new Promise((resolve) => {
      resolveCheckpoint = resolve;
    });
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
    deleteCheckpoint(); // Clean up singleton
    // Setup
    const checkpoint1 = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );
    const checkpoint2 = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );

    // Mock to delay first checkpoint
    let resolveFirst: (value: any) => void;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
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
    deleteCheckpoint(); // Clean up singleton
    // Setup second context
    const mockContext2 = {
      ...mockContext,
      executionContextId: "different-execution-context-id",
    } satisfies ExecutionContext;

    const checkpoint1 = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );
    const checkpoint2 = createCheckpoint(
      mockContext2,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    ); // Should return same handler (first context)

    // Execute checkpoints - both should use the first context (mockContext)
    const promises = [
      checkpoint1("step-1", { Action: OperationAction.START }),
      checkpoint2("step-2", { Action: OperationAction.START }),
    ];

    await Promise.all(promises);

    // Verify they were processed together using the first context
    expect(mockState.checkpoint).toHaveBeenCalledTimes(1);

    // Verify the call used the first token (from mockContext)
    const calls = mockState.checkpoint.mock.calls;
    expect(calls[0][0]).toBe(TEST_CONSTANTS.CHECKPOINT_TOKEN);

    // Verify both operations were included in the batch
    const checkpointData = calls[0][1];
    expect(checkpointData.Updates).toHaveLength(2);
  });

  it("should use the same handler for equivalent execution context ids, but different objects", async () => {
    deleteCheckpoint(); // Clean up singleton
    // Setup second context
    const mockContext2 = {
      ...mockContext,
      parentId: "different-parent-id",
    } satisfies ExecutionContext;

    const checkpoint1 = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );
    const checkpoint2 = createCheckpoint(
      mockContext2,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );

    // Execute checkpoints from both contexts
    const promises = [
      checkpoint1("step-1", { Action: OperationAction.START }),
      checkpoint2("step-2", { Action: OperationAction.START }),
    ];

    await Promise.all(promises);

    // Verify they were processed separately (one checkpoint calls)
    expect(mockState.checkpoint).toHaveBeenCalledTimes(1);

    // Verify each call had the correct token
    const calls = mockState.checkpoint.mock.calls;
    expect(calls[0][1].Updates).toHaveLength(2);
    expect(calls[0][1].Updates[0].Id).toBe(hashId("step-1"));
    expect(calls[0][1].Updates[1].Id).toBe(hashId("step-2"));
  });
});
