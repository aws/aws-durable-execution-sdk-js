import {
  OperationAction,
  OperationType,
  OperationUpdate,
} from "@aws-sdk/client-lambda";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { OperationSubType, ExecutionContext } from "../../types";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import { CheckpointHandler, createCheckpoint } from "./checkpoint";
import { createTestExecutionContext } from "../../testing/create-test-execution-context";
import { hashId } from "../step-id-utils/step-id-utils";
import { EventEmitter } from "events";

// Mock dependencies
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

describe("CheckpointHandler", () => {
  let mockTerminationManager: TerminationManager;
  let mockState: any;
  let mockContext: ExecutionContext;
  let checkpointHandler: CheckpointHandler;
  let mockEmitter: EventEmitter;

  const mockNewTaskToken = "new-task-token";

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitter = new EventEmitter();

    mockState = {
      checkpoint: jest.fn().mockResolvedValue({
        CheckpointToken: mockNewTaskToken,
      }),
    };

    mockContext = createTestExecutionContext({
      durableExecutionArn: "test-durable-execution-arn",
      state: mockState,
    });
    mockTerminationManager = mockContext.terminationManager;
    jest.spyOn(mockTerminationManager, "terminate");

    checkpointHandler = new CheckpointHandler(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
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
        TEST_CONSTANTS.CHECKPOINT_TOKEN,
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
        undefined, // logger parameter
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
      );
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
      );
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
      );
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
      const checkpointPromise = new Promise((resolve) => {
        resolveCheckpoint = resolve;
      });
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
        TEST_CONSTANTS.CHECKPOINT_TOKEN,
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
        undefined, // logger parameter
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

describe("createCheckpointHandler", () => {
  // Setup common test variables
  const mockStepId = "test-step-id";

  const mockCheckpointResponse = {
    CheckpointToken: "new-task-token",
  };

  let mockTerminationManager: TerminationManager;
  let mockState: any;
  let mockContext: ExecutionContext;
  let mockEmitter: EventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitter = new EventEmitter();

    mockState = {
      checkpoint: jest.fn().mockResolvedValue(mockCheckpointResponse),
      getStepData: jest.fn(),
    };

    mockContext = createTestExecutionContext({
      durableExecutionArn: "test-durable-execution-arn",
      state: mockState,
    });
    mockTerminationManager = mockContext.terminationManager;
    jest.spyOn(mockTerminationManager, "terminate");
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
    );
    await checkpoint(mockStepId, checkpointData);

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
      undefined, // logger parameter
    );
  });

  it("should batch multiple checkpoints together", async () => {
    // Setup
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
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
    // Setup
    const checkpoint1 = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
    );
    const checkpoint2 = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
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

  it("should use separate checkpoint handlers for different execution contexts", async () => {
    // Setup second context
    const mockContext2 = createTestExecutionContext({
      durableExecutionArn: "test-durable-execution-arn",
      state: mockState,
    });

    const checkpoint1 = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
    );
    const checkpoint2 = createCheckpoint(
      mockContext2,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
    ); // Should create separate handler for each context

    // Execute checkpoints - each should use its own context
    const promises = [
      checkpoint1("step-1", { Action: OperationAction.START }),
      checkpoint2("step-2", { Action: OperationAction.START }),
    ];

    await Promise.all(promises);

    // Verify they were processed separately (one call per context)
    expect(mockState.checkpoint).toHaveBeenCalledTimes(2);

    // Verify both calls used the same token
    const calls = mockState.checkpoint.mock.calls;
    expect(calls[0][0]).toBe(TEST_CONSTANTS.CHECKPOINT_TOKEN);
    expect(calls[1][0]).toBe(TEST_CONSTANTS.CHECKPOINT_TOKEN);

    // Verify each call has one operation
    expect(calls[0][1].Updates).toHaveLength(1);
    expect(calls[1][1].Updates).toHaveLength(1);
  });

  it("should use separate handlers for different execution context objects", async () => {
    // Setup second context
    const mockContext2 = createTestExecutionContext({
      durableExecutionArn: "test-durable-execution-arn",
      state: mockState,
    });

    const checkpoint1 = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
    );
    const checkpoint2 = createCheckpoint(
      mockContext2,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
    );

    // Execute checkpoints from both contexts
    const promises = [
      checkpoint1("step-1", { Action: OperationAction.START }),
      checkpoint2("step-2", { Action: OperationAction.START }),
    ];

    await Promise.all(promises);

    // Verify they were processed separately (two checkpoint calls)
    expect(mockState.checkpoint).toHaveBeenCalledTimes(2);

    // Verify each call had the correct token and one operation
    const calls = mockState.checkpoint.mock.calls;
    expect(calls[0][1].Updates).toHaveLength(1);
    expect(calls[1][1].Updates).toHaveLength(1);
    expect(calls[0][1].Updates[0].Id).toBe(hashId("step-1"));
    expect(calls[1][1].Updates[0].Id).toBe(hashId("step-2"));
  });

  it("should split large payloads into multiple API calls when exceeding 750KB limit", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
    );

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
    expect(mockState.checkpoint.mock.calls[0][1].Updates).toHaveLength(1);
    // Second call should have the remaining item
    expect(mockState.checkpoint.mock.calls[1][1].Updates).toHaveLength(1);
  });

  it("should split large payloads into multiple API calls when exceeding 750KB limit for large unicode characters", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
    );

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
    expect(mockState.checkpoint.mock.calls[0][1].Updates).toHaveLength(1);
    // Second call should have the remaining item
    expect(mockState.checkpoint.mock.calls[1][1].Updates).toHaveLength(1);
  });

  it("should process remaining items in queue after size limit is reached", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
    );

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
      (call: any) => call[1].Updates,
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
    );

    // Mock checkpoint response with operations
    const mockOperations = [
      {
        Id: hashId("test-step"),
        Type: OperationType.STEP,
        Action: OperationAction.START,
        Payload: "test-result",
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
    );
  });
});
