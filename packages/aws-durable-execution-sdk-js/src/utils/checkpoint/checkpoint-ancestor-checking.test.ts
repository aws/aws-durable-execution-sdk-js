import { createTestCheckpointManager } from "../../testing/create-test-checkpoint-manager";
import {
  OperationAction,
  OperationType,
  OperationStatus,
} from "@aws-sdk/client-lambda";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { DurableLogger, ExecutionContext } from "../../types";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import { CheckpointManager } from "./checkpoint-manager";
import { hashId, getStepData } from "../step-id-utils/step-id-utils";
import { EventEmitter } from "events";
import { createDefaultLogger } from "../logger/default-logger";

// Mock dependencies
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

describe("CheckpointManager - Ancestor Checking", () => {
  let mockTerminationManager: TerminationManager;
  let mockState: any;
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
      requestId: "mock-request-id",
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

  it("should skip checkpoint when direct parent is SUCCEEDED", async () => {
    const parentId = "parent-step";
    const childId = "child-step";

    // Setup parent as SUCCEEDED
    mockContext._stepData[hashId(parentId)] = {
      Id: hashId(parentId),
      Status: "SUCCEEDED",
      Type: OperationType.STEP,
      StartTimestamp: new Date(),
    } as any;

    checkpointHandler.checkpoint(childId, {
      ParentId: parentId,
      Action: OperationAction.START,
      Type: OperationType.STEP,
    });

    // Wait for next tick
    await new Promise((resolve) => setImmediate(resolve));

    // Checkpoint should not be called
    expect(mockState.checkpoint).not.toHaveBeenCalled();
    expect(checkpointHandler.getQueueStatus().queueLength).toBe(0);
  });

  it("should skip checkpoint when direct parent is FAILED", async () => {
    const parentId = "parent-step";
    const childId = "child-step";

    // Setup parent as FAILED
    mockContext._stepData[hashId(parentId)] = {
      Id: hashId(parentId),
      Status: "FAILED",
      Type: OperationType.STEP,
      StartTimestamp: new Date(),
    } as any;

    checkpointHandler.checkpoint(childId, {
      ParentId: parentId,
      Action: OperationAction.START,
      Type: OperationType.STEP,
    });

    // Wait for next tick
    await new Promise((resolve) => setImmediate(resolve));

    // Checkpoint should not be called
    expect(mockState.checkpoint).not.toHaveBeenCalled();
    expect(checkpointHandler.getQueueStatus().queueLength).toBe(0);
  });

  it("should skip checkpoint when ancestor (grandparent) is SUCCEEDED", async () => {
    const grandparentId = "grandparent-step";
    const parentId = "parent-step";
    const childId = "child-step";

    // Setup grandparent as SUCCEEDED
    mockContext._stepData[hashId(grandparentId)] = {
      Id: hashId(grandparentId),
      Status: "SUCCEEDED",
      Type: OperationType.STEP,
      StartTimestamp: new Date(),
    } as any;

    // Setup parent as STARTED with reference to grandparent
    mockContext._stepData[hashId(parentId)] = {
      Id: hashId(parentId),
      Status: "STARTED",
      ParentId: hashId(grandparentId),
      Type: OperationType.STEP,
      StartTimestamp: new Date(),
    } as any;

    checkpointHandler.checkpoint(childId, {
      ParentId: parentId,
      Action: OperationAction.START,
      Type: OperationType.STEP,
    });

    // Wait for next tick
    await new Promise((resolve) => setImmediate(resolve));

    // Checkpoint should not be called
    expect(mockState.checkpoint).not.toHaveBeenCalled();
    expect(checkpointHandler.getQueueStatus().queueLength).toBe(0);
  });

  it("should process checkpoint when parent is STARTED", async () => {
    const parentId = "parent-step";
    const childId = "child-step";

    // Setup parent as STARTED
    mockContext._stepData[hashId(parentId)] = {
      Id: hashId(parentId),
      Status: "STARTED",
      Type: OperationType.STEP,
      StartTimestamp: new Date(),
    } as any;

    await checkpointHandler.checkpoint(childId, {
      ParentId: parentId,
      Action: OperationAction.START,
      Type: OperationType.STEP,
    });

    // Checkpoint should be called
    expect(mockState.checkpoint).toHaveBeenCalledTimes(1);
  });

  it("should process checkpoint when no parent is specified", async () => {
    const stepId = "root-step";

    await checkpointHandler.checkpoint(stepId, {
      Action: OperationAction.START,
      Type: OperationType.STEP,
    });

    // Checkpoint should be called
    expect(mockState.checkpoint).toHaveBeenCalledTimes(1);
  });

  it("should process checkpoint when parent does not exist in stepData", async () => {
    const parentId = "non-existent-parent";
    const childId = "child-step";

    await checkpointHandler.checkpoint(childId, {
      ParentId: parentId,
      Action: OperationAction.START,
      Type: OperationType.STEP,
    });

    // Checkpoint should be called (parent not found means it's not finished)
    expect(mockState.checkpoint).toHaveBeenCalledTimes(1);
  });

  it("should check entire ancestor chain up to root", async () => {
    const rootId = "root";
    const level1Id = "level1";
    const level2Id = "level2";
    const level3Id = "level3";

    // Setup ancestor chain with root as SUCCEEDED
    mockContext._stepData[hashId(rootId)] = {
      Id: hashId(rootId),
      Status: "SUCCEEDED",
      Type: OperationType.STEP,
      StartTimestamp: new Date(),
    } as any;

    mockContext._stepData[hashId(level1Id)] = {
      Id: hashId(level1Id),
      Status: "STARTED",
      ParentId: hashId(rootId),
      Type: OperationType.STEP,
      StartTimestamp: new Date(),
    } as any;

    mockContext._stepData[hashId(level2Id)] = {
      Id: hashId(level2Id),
      Status: "STARTED",
      ParentId: hashId(level1Id),
      Type: OperationType.STEP,
      StartTimestamp: new Date(),
    } as any;

    checkpointHandler.checkpoint(level3Id, {
      ParentId: level2Id,
      Action: OperationAction.START,
      Type: OperationType.STEP,
    });

    // Wait for next tick
    await new Promise((resolve) => setImmediate(resolve));

    // Checkpoint should not be called (root ancestor is SUCCEEDED)
    expect(mockState.checkpoint).not.toHaveBeenCalled();
    expect(checkpointHandler.getQueueStatus().queueLength).toBe(0);
  });

  it("should skip checkpoint when ancestor is finished (SUCCEEDED in stepData)", async () => {
    const parentId = "parent-operation";
    const childId = "child-operation";

    // Set up parent as SUCCEEDED in stepData
    mockContext._stepData[hashId(parentId)] = {
      Id: hashId(parentId),
      Status: OperationStatus.SUCCEEDED,
      Type: OperationType.CONTEXT,
      StartTimestamp: new Date(),
    } as any;

    // Set up child with parent relationship
    mockContext._stepData[hashId(childId)] = {
      Id: hashId(childId),
      Status: OperationStatus.STARTED,
      ParentId: hashId(parentId),
      Type: OperationType.STEP,
      StartTimestamp: new Date(),
    } as any;

    // Try to checkpoint child success - should be skipped
    const checkpointPromise = checkpointHandler.checkpoint(childId, {
      Action: OperationAction.SUCCEED,
      Type: OperationType.STEP,
    });

    // Wait for next tick
    await new Promise((resolve) => setImmediate(resolve));

    // Checkpoint should not be called (parent is SUCCEEDED)
    expect(mockState.checkpoint).not.toHaveBeenCalled();
    expect(checkpointHandler.getQueueStatus().queueLength).toBe(0);

    // Promise should never resolve (returns never-resolving promise)
    let resolved = false;
    checkpointPromise.then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(resolved).toBe(false);
  });

  it("should skip checkpoint when ancestor has pending completion", async () => {
    const parentId = "parent-operation";
    const childId = "child-operation";

    // Set up parent-child relationship in stepData
    mockContext._stepData[hashId(parentId)] = {
      Id: hashId(parentId),
      Status: OperationStatus.STARTED,
      Type: OperationType.CONTEXT,
      StartTimestamp: new Date(),
    } as any;

    mockContext._stepData[hashId(childId)] = {
      Id: hashId(childId),
      Status: OperationStatus.STARTED,
      ParentId: hashId(parentId),
      Type: OperationType.STEP,
      StartTimestamp: new Date(),
    } as any;

    // Add parent to pending completions
    mockContext.pendingCompletions.add(hashId(parentId));

    // Try to checkpoint child success - should be skipped
    const checkpointPromise = checkpointHandler.checkpoint(childId, {
      Action: OperationAction.SUCCEED,
      Type: OperationType.STEP,
    });

    // Wait for next tick
    await new Promise((resolve) => setImmediate(resolve));

    // Checkpoint should not be called (parent has pending completion)
    expect(mockState.checkpoint).not.toHaveBeenCalled();
    expect(checkpointHandler.getQueueStatus().queueLength).toBe(0);

    // Promise should never resolve
    let resolved = false;
    checkpointPromise.then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(resolved).toBe(false);
  });

  it("should allow checkpoint when no ancestor is finished", async () => {
    const parentId = "parent-operation";
    const childId = "child-operation";

    // Set up parent as STARTED (not finished)
    mockContext._stepData[hashId(parentId)] = {
      Id: hashId(parentId),
      Status: OperationStatus.STARTED,
      Type: OperationType.CONTEXT,
      StartTimestamp: new Date(),
    } as any;

    // Set up child with parent relationship
    mockContext._stepData[hashId(childId)] = {
      Id: hashId(childId),
      Status: OperationStatus.STARTED,
      ParentId: hashId(parentId),
      Type: OperationType.STEP,
      StartTimestamp: new Date(),
    } as any;

    // Try to checkpoint child success - should proceed
    checkpointHandler.checkpoint(childId, {
      Action: OperationAction.SUCCEED,
      Type: OperationType.STEP,
    });

    // Wait for next tick
    await new Promise((resolve) => setImmediate(resolve));

    // Checkpoint should be called (no ancestor is finished)
    expect(mockState.checkpoint).toHaveBeenCalled();
    expect(checkpointHandler.getQueueStatus().queueLength).toBe(0);
  });
});
