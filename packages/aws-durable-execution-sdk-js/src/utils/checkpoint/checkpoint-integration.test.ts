import { createCheckpoint } from "./checkpoint";
import { ExecutionContext, OperationSubType } from "../../types";
import { OperationAction, OperationType } from "@aws-sdk/client-lambda";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { hashId } from "../step-id-utils/step-id-utils";
import { createTestExecutionContext } from "../../testing/create-test-execution-context";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import { EventEmitter } from "events";

// Mock dependencies
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

describe("Checkpoint Integration Tests", () => {
  let mockTerminationManager: TerminationManager;
  let mockState: any;
  let mockContext: ExecutionContext;
  let mockEmitter: EventEmitter;

  const mockNewTaskToken = "new-task-token";

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitter = new EventEmitter();

    mockState = {
      checkpoint: jest.fn().mockResolvedValue({
        checkpointToken: mockNewTaskToken,
      }),
    };

    mockContext = createTestExecutionContext({
      durableExecutionArn: "test-durable-execution-arn",
      state: mockState,
    });
    mockTerminationManager = mockContext.terminationManager;
    jest.spyOn(mockTerminationManager, "terminate");
  });

  it("should demonstrate performance improvement with batching", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
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
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
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
      undefined, // logger parameter
    );
  });

  it("should process all operations immediately regardless of count", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
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
      undefined, // logger parameter
    );
  });

  it("should handle large numbers of operations in a single batch", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
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

  it("should use separate checkpoint handlers for different execution contexts", async () => {
    // Create second context
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

    // Should have made two separate checkpoint calls (one per context)
    expect(mockState.checkpoint).toHaveBeenCalledTimes(2);

    // Verify both calls used the same token
    const calls = mockState.checkpoint.mock.calls;
    expect(calls[0][0]).toBe(TEST_CONSTANTS.CHECKPOINT_TOKEN);
    expect(calls[1][0]).toBe(TEST_CONSTANTS.CHECKPOINT_TOKEN);

    // Verify each call has one operation
    expect(calls[0][1].Updates).toHaveLength(1);
    expect(calls[1][1].Updates).toHaveLength(1);
  });
});
