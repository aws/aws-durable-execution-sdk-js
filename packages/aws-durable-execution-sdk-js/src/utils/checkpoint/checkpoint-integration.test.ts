import { CheckpointManager } from "./checkpoint-manager";
import { CheckpointFunction } from "../../testing/mock-checkpoint";
import { DurableLogger, ExecutionContext, OperationSubType } from "../../types";
import { OperationAction, OperationType } from "@aws-sdk/client-lambda";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { hashId } from "../step-id-utils/step-id-utils";
import { createMockExecutionContext } from "../../testing/mock-context";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import { EventEmitter } from "events";
import { createDefaultLogger } from "../logger/default-logger";

// Mock dependencies
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

describe("Checkpoint Integration Tests", () => {
  let mockTerminationManager: TerminationManager;
  let mockState: any;
  let mockState2: any;
  let mockContext: ExecutionContext;
  let mockEmitter: EventEmitter;
  let mockLogger: DurableLogger;

  const mockNewTaskToken = "new-task-token";

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitter = new EventEmitter();

    mockTerminationManager = new TerminationManager();
    jest.spyOn(mockTerminationManager, "terminate");

    mockState = {
      checkpoint: jest.fn().mockResolvedValue({
        checkpointToken: mockNewTaskToken,
      }),
    };

    mockContext = createMockExecutionContext({
      durableExecutionArn: "test-durable-execution-arn",
      durableExecutionClient: mockState,
      terminationManager: mockTerminationManager,
    });

    mockLogger = createDefaultLogger(mockContext);
  });

  it("should demonstrate performance improvement with batching", async () => {
    const checkpointManager = new CheckpointManager(
      "test-arn",
      {},
      mockState,
      { terminate: jest.fn() } as any,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
      new Set<string>(),
    );
    const checkpoint = (stepId: string, data: any): Promise<any> =>
      checkpointManager.checkpoint(stepId, data);

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
      (sum: number, call: any) => sum + call[0].Updates.length,
      0,
    ) as unknown as CheckpointFunction;
    expect(totalUpdates).toBe(8);
  });

  it("should handle mixed operation types in a single batch", async () => {
    const checkpointManager = new CheckpointManager(
      "test-arn",
      {},
      mockState,
      { terminate: jest.fn() } as any,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
      new Set<string>(),
    );
    const checkpoint = (stepId: string, data: any): Promise<any> =>
      checkpointManager.checkpoint(stepId, data);

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
      {
        DurableExecutionArn: "test-arn",
        CheckpointToken: TEST_CONSTANTS.CHECKPOINT_TOKEN,
        Updates: [
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
        ],
      },
      mockLogger,
    ) as unknown as CheckpointFunction;
  });

  it("should process all operations immediately regardless of count", async () => {
    const checkpointManager = new CheckpointManager(
      "test-arn",
      {},
      mockState,
      { terminate: jest.fn() } as any,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
      new Set<string>(),
    );
    const checkpoint = (stepId: string, data: any): Promise<any> =>
      checkpointManager.checkpoint(stepId, data);

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
      {
        DurableExecutionArn: "test-arn",
        CheckpointToken: TEST_CONSTANTS.CHECKPOINT_TOKEN,
        Updates: Array.from({ length: 10 }, (_, i) =>
          expect.objectContaining({ Id: hashId(`step-${i}`) }),
        ),
      },
      mockLogger,
    ) as unknown as CheckpointFunction;
  });

  it("should handle large numbers of operations in a single batch", async () => {
    const checkpointManager = new CheckpointManager(
      "test-arn",
      {},
      mockState,
      { terminate: jest.fn() } as any,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
      new Set<string>(),
    );
    const checkpoint = (stepId: string, data: any): Promise<any> =>
      checkpointManager.checkpoint(stepId, data);

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
    expect(mockState.checkpoint.mock.calls[0][0].Updates).toHaveLength(15);

    // Verify all operations were processed
    const processedIds = mockState.checkpoint.mock.calls[0][0].Updates.map(
      (update: any) => update.Id,
    ) as unknown as CheckpointFunction;
    expect(processedIds).toEqual(
      Array.from({ length: 15 }, (_, i) => hashId(`step-${i}`)),
    ) as unknown as CheckpointFunction;
  });

  it("should use the first execution context when multiple contexts are created", async () => {
    // Create second mock state
    mockState2 = {
      checkpoint: jest.fn().mockResolvedValue({
        checkpointToken: mockNewTaskToken,
      }),
    };

    // Create second context
    const _mockContext2 = createMockExecutionContext({
      durableExecutionArn: "test-durable-execution-arn-2",
      durableExecutionClient: mockState2,
      terminationManager: mockTerminationManager,
    });

    const checkpointManager1 = new CheckpointManager(
      "test-arn",
      {},
      mockState,
      { terminate: jest.fn() } as any,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
      new Set<string>(),
    );
    const checkpoint1 = (stepId: string, data: any): Promise<any> =>
      checkpointManager1.checkpoint(stepId, data);

    const checkpointManager2 = new CheckpointManager(
      "test-arn-2",
      {},
      mockState2,
      { terminate: jest.fn() } as any,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
      new Set<string>(),
    );
    const checkpoint2 = (stepId: string, data: any): Promise<any> =>
      checkpointManager2.checkpoint(stepId, data);

    // Execute checkpoints - each should use its own context
    const promises = [
      checkpoint1("step-1", { Action: OperationAction.START }),
      checkpoint2("step-2", { Action: OperationAction.START }),
    ];

    await Promise.all(promises);

    // With instance-based architecture, each context gets its own manager
    // So we expect calls to both contexts
    expect(mockState.checkpoint).toHaveBeenCalledTimes(1);
    expect(mockState2.checkpoint).toHaveBeenCalledTimes(1);

    // Verify each checkpoint was called with its respective operation
    expect(mockState.checkpoint.mock.calls[0][0].Updates).toHaveLength(1);
    expect(mockState2.checkpoint.mock.calls[0][0].Updates).toHaveLength(1);
  });
});
