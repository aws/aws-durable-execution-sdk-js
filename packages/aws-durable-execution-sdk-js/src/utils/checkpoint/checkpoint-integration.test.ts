import { createCheckpoint, deleteCheckpoint } from "./checkpoint";
import { ExecutionContext, OperationSubType } from "../../types";
import { OperationAction, OperationType } from "@aws-sdk/client-lambda";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { randomUUID } from "crypto";
import { hashId } from "../step-id-utils/step-id-utils";
import { createMockExecutionContext } from "../../testing/mock-context";
import { TEST_CONSTANTS } from "../../testing/test-constants";

// Mock dependencies
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

describe("Checkpoint Integration Tests", () => {
  let mockTerminationManager: TerminationManager;
  let mockState: any;
  let mockContext: ExecutionContext;

  const mockNewTaskToken = "new-task-token";

  beforeEach(() => {
    jest.clearAllMocks();

    mockTerminationManager = new TerminationManager();
    jest.spyOn(mockTerminationManager, "terminate");

    mockState = {
      checkpoint: jest.fn().mockResolvedValue({
        checkpointToken: mockNewTaskToken,
      }),
    };

    mockContext = createMockExecutionContext({
      customerHandlerEvent: {},
      executionContextId: randomUUID(),
      durableExecutionArn: "test-durable-execution-arn",
      state: mockState,
      terminationManager: mockTerminationManager,
      isVerbose: false,
    });
  });

  it("should demonstrate performance improvement with batching", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );

    // Create many concurrent checkpoint requests
    const promises = Array.from({ length: 8 }, (_, i) =>
      checkpoint(`step-${i}`, {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      }),
    );

    // Should process immediately with batching
    await Promise.all(promises);

    // Should have made a single checkpoint call due to batching
    expect(mockState.checkpoint).toHaveBeenCalledTimes(1);

    // Verify all operations were processed in one batch
    const totalUpdates = mockState.checkpoint.mock.calls.reduce(
      (sum: number, call: any) => sum + call[1].Updates.length,
      0,
    );
    expect(totalUpdates).toBe(8);
  });

  it("should handle mixed operation types in a single batch", async () => {
    deleteCheckpoint(); // Clean up singleton
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );

    // Create checkpoints with different operation types and actions
    const promises = [
      checkpoint("step-1", {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        Name: "Test Step 1",
      }),
      checkpoint("step-2", {
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        Payload: "success result",
      }),
      checkpoint("wait-1", {
        Action: OperationAction.START,
        SubType: OperationSubType.WAIT,
        Type: OperationType.WAIT,
        WaitOptions: { WaitSeconds: 5 },
      }),
      checkpoint("step-3", {
        Action: OperationAction.RETRY,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        Payload: "retry reason",
        StepOptions: { NextAttemptDelaySeconds: 10 },
      }),
    ];

    await Promise.all(promises);

    // Should have batched all different operation types together
    expect(mockState.checkpoint).toHaveBeenCalledWith(
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      expect.objectContaining({
        Updates: expect.arrayContaining([
          expect.objectContaining({
            Id: hashId("step-1"),
            Action: OperationAction.START,
            SubType: OperationSubType.STEP,
            Type: OperationType.STEP,
            Name: "Test Step 1",
          }),
          expect.objectContaining({
            Id: hashId("step-2"),
            Action: OperationAction.SUCCEED,
            SubType: OperationSubType.STEP,
            Type: OperationType.STEP,
            Payload: "success result",
          }),
          expect.objectContaining({
            Id: hashId("wait-1"),
            Action: OperationAction.START,
            SubType: OperationSubType.WAIT,
            Type: OperationType.WAIT,
            WaitOptions: { WaitSeconds: 5 },
          }),
          expect.objectContaining({
            Id: hashId("step-3"),
            Action: OperationAction.RETRY,
            SubType: OperationSubType.STEP,
            Type: OperationType.STEP,
            Payload: "retry reason",
            StepOptions: { NextAttemptDelaySeconds: 10 },
          }),
        ]),
      }),
    );
  });

  it("should process all operations immediately regardless of count", async () => {
    deleteCheckpoint(); // Clean up singleton
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );

    // Create many requests (previously would have been split by max batch size)
    const promises = Array.from({ length: 10 }, (_, i) =>
      checkpoint(`step-${i}`, {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      }),
    );

    // Should process all immediately in a single batch
    await Promise.all(promises);

    expect(mockState.checkpoint).toHaveBeenCalledTimes(1);
    expect(mockState.checkpoint).toHaveBeenCalledWith(
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      expect.objectContaining({
        Updates: expect.arrayContaining(
          Array.from({ length: 10 }, (_, i) =>
            expect.objectContaining({ Id: hashId(`step-${i}`) }),
          ),
        ),
      }),
    );
  });

  it("should handle large numbers of operations in a single batch", async () => {
    deleteCheckpoint(); // Clean up singleton
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );

    // Create many requests (previously would have required multiple batches)
    const promises = Array.from({ length: 15 }, (_, i) =>
      checkpoint(`step-${i}`, {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      }),
    );

    // Should process all operations in a single batch immediately
    await Promise.all(promises);

    expect(mockState.checkpoint).toHaveBeenCalledTimes(1);
    expect(mockState.checkpoint.mock.calls[0][1].Updates).toHaveLength(15);

    // Verify all operations were processed
    const processedIds = mockState.checkpoint.mock.calls[0][1].Updates.map(
      (update: any) => update.Id,
    );
    expect(processedIds).toEqual(
      Array.from({ length: 15 }, (_, i) => hashId(`step-${i}`)),
    );
  });

  it("should use the first execution context when multiple contexts are created", async () => {
    deleteCheckpoint(); // Clean up singleton
    // Create second context
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

    // Should have made one checkpoint call with both operations batched using first context
    expect(mockState.checkpoint).toHaveBeenCalledTimes(1);

    // Verify the call used the first token (from mockContext)
    const calls = mockState.checkpoint.mock.calls;
    expect(calls[0][0]).toBe(TEST_CONSTANTS.CHECKPOINT_TOKEN);

    // Verify both operations were included in the batch
    const checkpointData = calls[0][1];
    expect(checkpointData.Updates).toHaveLength(2);
  });
});
