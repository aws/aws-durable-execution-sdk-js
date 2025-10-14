import { OperationAction, OperationType } from "@aws-sdk/client-lambda";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { ExecutionContext } from "../../types";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import { CheckpointHandler } from "./checkpoint";
import { hashId, getStepData } from "../step-id-utils/step-id-utils";

// Mock dependencies
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

describe("CheckpointHandler - Ancestor Checking", () => {
  let mockTerminationManager: TerminationManager;
  let mockState: any;
  let mockContext: ExecutionContext;
  let checkpointHandler: CheckpointHandler;

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
      durableExecutionArn: "test-durable-execution-arn",
      state: mockState,
      _stepData: stepData,
      terminationManager: mockTerminationManager,
      getStepData: jest.fn((stepId: string) => {
        return getStepData(stepData, stepId);
      }),
    } satisfies ExecutionContext;

    checkpointHandler = new CheckpointHandler(
      mockContext,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
    );
  });

  it("should skip checkpoint when direct parent is SUCCEEDED", async () => {
    const parentId = "parent-step";
    const childId = "child-step";

    // Setup parent as SUCCEEDED
    mockContext._stepData[hashId(parentId)] = {
      Id: hashId(parentId),
      Status: "SUCCEEDED",
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
    } as any;

    // Setup parent as STARTED with reference to grandparent
    mockContext._stepData[hashId(parentId)] = {
      Id: hashId(parentId),
      Status: "STARTED",
      ParentId: hashId(grandparentId),
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
    } as any;

    mockContext._stepData[hashId(level1Id)] = {
      Id: hashId(level1Id),
      Status: "STARTED",
      ParentId: hashId(rootId),
    } as any;

    mockContext._stepData[hashId(level2Id)] = {
      Id: hashId(level2Id),
      Status: "STARTED",
      ParentId: hashId(level1Id),
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
});
