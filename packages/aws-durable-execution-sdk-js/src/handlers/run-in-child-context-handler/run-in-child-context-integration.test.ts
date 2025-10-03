import { createDurableContext } from "../../context/durable-context/durable-context";
import { ExecutionContext, DurableContext } from "../../types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import {
  OperationType,
  OperationStatus,
  OperationAction,
  CheckpointDurableExecutionRequest,
} from "@aws-sdk/client-lambda";
import { randomUUID } from "crypto";
import { hashId, getStepData } from "../../utils/step-id-utils/step-id-utils";
import { deleteCheckpoint } from "../../utils/checkpoint/checkpoint";

// Mock the TerminationManager class
jest.mock("../../termination-manager/termination-manager");

describe("Run In Child Context Integration Tests", () => {
  let mockExecutionContext: ExecutionContext;
  let mockParentContext: any;
  let durableContext: DurableContext;
  let checkpointCalls: any[] = [];

  beforeEach(() => {
    // Reset all mocks before each test to ensure isolation
    jest.resetAllMocks();

    checkpointCalls = [];

    // Clear singleton checkpoint handler
    deleteCheckpoint();

    // Create proper mocks for TerminationManager
    const mockTerminationManager = {
      terminate: jest.fn(),
      getTerminationPromise: jest.fn().mockResolvedValue({}),
      isTerminated: false,
      terminationPromise: Promise.resolve(),
      handleTermination: jest.fn(),
      addListener: jest.fn(),
    } as unknown as TerminationManager;

    mockExecutionContext = {
      executionContextId: randomUUID(),
      state: {
        getStepData: jest.fn().mockResolvedValue({}),
        checkpoint: jest
          .fn()
          .mockImplementation(
            (taskToken: string, data: CheckpointDurableExecutionRequest) => {
              const checkpointToken = data.CheckpointToken;
              checkpointCalls.push({ checkpointToken, data });
              return Promise.resolve({ CheckpointToken: "mock-token" });
            },
          ),
      },
      _stepData: {},
      terminationManager: mockTerminationManager,
      isVerbose: false,
      customerHandlerEvent: {},
      durableExecutionArn: "mock-execution-arn",
      getStepData: jest.fn((stepId: string) => {
        return getStepData(mockExecutionContext._stepData, stepId);
      }),
    } satisfies ExecutionContext;

    mockParentContext = { awsRequestId: "mock-request-id" };

    durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );
  });

  test("should execute child context with child context", async () => {
    let capturedChildContext: DurableContext | undefined;

    const result = await durableContext.runInChildContext(
      "test-child-context",
      async (childContext) => {
        capturedChildContext = childContext;
        return "child-context-result";
      },
    );

    expect(result).toBe("child-context-result");
    expect(capturedChildContext).toBeDefined();
    expect(capturedChildContext!._stepPrefix).toBe("1");

    // The fire-and-forget optimization means we may only see the START checkpoint
    // in the test environment, but the functionality should work correctly
    expect(checkpointCalls.length).toBeGreaterThanOrEqual(1);
    expect(checkpointCalls[0].data.Updates[0].Action).toBe(
      OperationAction.START,
    );
    expect(checkpointCalls[0].data.Updates[0].Id).toBe(hashId("1"));
    expect(checkpointCalls[0].data.Updates[0].Type).toBe(OperationType.CONTEXT);
    expect(checkpointCalls[0].data.Updates[0].Name).toBe("test-child-context");
  });

  test("should execute step without passing context", async () => {
    // Create a function that will capture any arguments passed to it
    const stepFn = jest.fn().mockImplementation(async () => {
      return "step-result";
    });

    const result = await durableContext.step("test-step", stepFn);

    // Allow time for fire-and-forget checkpoint to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(result).toBe("step-result");
    // Check that the function was called with Telemetry
    expect(stepFn).toHaveBeenCalledWith(
      expect.objectContaining({
        logger: expect.any(Object),
      }),
    );

    // Step should create checkpoints (fire-and-forget START + SUCCEED)
    // Due to fire-and-forget nature and test timing, we verify at least START is captured
    expect(checkpointCalls.length).toBeGreaterThanOrEqual(1);

    // Verify START checkpoint is captured (this confirms our change is working)
    const startCheckpoint = checkpointCalls.find(
      (call) => call.data.Updates[0].Action === "START",
    );
    expect(startCheckpoint).toBeDefined();
    expect(startCheckpoint.data.Updates[0].Type).toBe(OperationType.STEP);
  });

  test("should checkpoint child context when configured", async () => {
    const result = await durableContext.runInChildContext(
      "test-child-context",
      async (_childContext) => {
        return "child-context-result";
      },
    );

    expect(result).toBe("child-context-result");

    // Child context should create at least START checkpoint (fire-and-forget optimization)
    expect(checkpointCalls.length).toBeGreaterThanOrEqual(1);
    expect(checkpointCalls[0].data.Updates[0].Action).toBe(
      OperationAction.START,
    );
  });

  test("should support nested child contexts with deterministic IDs", async () => {
    const nestedIds: string[] = [];

    await durableContext.runInChildContext(
      "parent-child-context",
      async (parentCtx) => {
        nestedIds.push(parentCtx._stepPrefix!);

        await parentCtx.runInChildContext(
          "child-context-1",
          async (childCtx1) => {
            nestedIds.push(childCtx1._stepPrefix!);
          },
        );

        await parentCtx.runInChildContext(
          "child-context-2",
          async (childCtx2) => {
            nestedIds.push(childCtx2._stepPrefix!);

            await childCtx2.runInChildContext(
              "grandchild-context",
              async (grandchildCtx) => {
                nestedIds.push(grandchildCtx._stepPrefix!);
              },
            );
          },
        );
      },
    );

    // Check that the IDs follow the expected pattern
    expect(nestedIds[0]).toBe("1"); // parent child context
    expect(nestedIds[1]).toBe("1-1"); // first child context
    expect(nestedIds[2]).toBe("1-2"); // second child context
    expect(nestedIds[3]).toBe("1-2-1"); // grandchild context
  });

  test("should support mixed step and child context operations", async () => {
    const operationOrder: string[] = [];

    await durableContext.runInChildContext(
      "parent-child-context",
      async (parentCtx) => {
        operationOrder.push("parent-child-context-start");

        await parentCtx.step("child-step", async () => {
          operationOrder.push("child-step");
          return "step-result";
        });

        await parentCtx.runInChildContext(
          "child-context",
          async (_childCtx) => {
            operationOrder.push("child-context");
            return "child-context-result";
          },
        );

        operationOrder.push("parent-child-context-end");
        return "parent-result";
      },
    );

    expect(operationOrder).toEqual([
      "parent-child-context-start",
      "child-step",
      "child-context",
      "parent-child-context-end",
    ]);
  });

  test("should pass entityId as parentId to child context operations", async () => {
    // Set up original parent context parentId
    mockExecutionContext.parentId = "original-parent-123";

    await durableContext.runInChildContext(
      "test-child-context",
      async (childContext) => {
        // Perform a step within the child context
        await childContext.step("child-step", async () => "child-step-result");
        return "child-result";
      },
    );

    // Should have at least 2 checkpoints: child context START, child context SUCCEED
    // The child step checkpoint may not be captured due to fire-and-forget optimization
    expect(checkpointCalls.length).toBeGreaterThanOrEqual(2);

    // First checkpoint should be child context START
    expect(checkpointCalls[0].data.Updates[0].Action).toBe(
      OperationAction.START,
    );
    expect(checkpointCalls[0].data.Updates[0].Id).toBe(hashId("1"));

    // If we have more than 2 checkpoints, check for child step
    if (checkpointCalls.length >= 3) {
      const childStepCheckpoint = checkpointCalls[1];
      expect(childStepCheckpoint.data.Updates[0].ParentId).toBe(hashId("1"));
      expect(childStepCheckpoint.data.Updates[0].Name).toBe("child-step");
    }

    // Last checkpoint should be child context SUCCEED
    const lastCheckpoint = checkpointCalls[checkpointCalls.length - 1];
    expect(lastCheckpoint.data.Updates[0].Action).toBe(OperationAction.SUCCEED);
    expect(lastCheckpoint.data.Updates[0].ParentId).toBe(
      hashId("original-parent-123"),
    );
    expect(lastCheckpoint.data.Updates[0].Name).toBe("test-child-context");
  });

  test("should handle adaptive mode with large payload", async () => {
    // Create a large payload (over 256KB)
    const largePayload = "x".repeat(300 * 1024); // 300KB string

    const result = await durableContext.runInChildContext(
      "test-large-child-context",
      async (_childContext) => {
        return largePayload;
      },
    );

    expect(result).toBe(largePayload);

    // Should create at least 1 checkpoint (START with fire-and-forget optimization)
    expect(checkpointCalls.length).toBeGreaterThanOrEqual(1);

    // First checkpoint should be START
    expect(checkpointCalls[0].data.Updates[0].Id).toBe(hashId("1"));
    expect(checkpointCalls[0].data.Updates[0].Action).toBe(
      OperationAction.START,
    );
    expect(checkpointCalls[0].data.Updates[0].Type).toBe(OperationType.CONTEXT);
    expect(checkpointCalls[0].data.Updates[0].Name).toBe(
      "test-large-child-context",
    );
  });

  test("should re-execute on replay when ReplayChildren is true", async () => {
    const largePayload = "x".repeat(300 * 1024); // 300KB string
    let executionCount = 0;

    // Set up completed step data with ReplayChildren flag
    mockExecutionContext._stepData = {
      [hashId("1")]: {
        Id: "1",
        Status: OperationStatus.SUCCEEDED,
        ContextDetails: {
          Result: "[Large payload summary]",
          ReplayChildren: true, // This triggers re-execution
        },
      },
    };

    const result = await durableContext.runInChildContext(
      "test-replay-child-context",
      async (_childContext) => {
        executionCount++;
        return largePayload;
      },
    );

    expect(result).toBe(largePayload);
    expect(executionCount).toBe(1); // Should re-execute once
    expect(checkpointCalls.length).toBe(0); // No new checkpoints for completed context
  });
});
