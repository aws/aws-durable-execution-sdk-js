import { createWaitHandler } from "./wait-handler";
import { ExecutionContext, OperationSubType } from "../../types";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";

describe("Wait Handler Tests", () => {
  let context: ExecutionContext;
  let checkpoint: Checkpoint;
  let stepCounter: number;

  beforeEach(() => {
    stepCounter = 0;

    context = {
      _stepData: {},
      getStepData: jest.fn((stepId: string) => context._stepData[stepId]),
      durableExecutionArn: "test-arn",
      requestId: "test-request",
      tenantId: "test-tenant",
    } as any;

    checkpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      forceCheckpoint: jest.fn().mockResolvedValue(undefined),
      markOperationState: jest.fn(),
      waitForStatusChange: jest.fn().mockResolvedValue(undefined),
      markOperationAwaited: jest.fn(),
      getOperationState: jest.fn(),
      getAllOperations: jest.fn().mockReturnValue(new Map()),
    } as any;
  });

  const createStepId = (): string => `${++stepCounter}`;

  describe("Basic wait operation", () => {
    it("should mark operation states correctly", async () => {
      const waitHandler = createWaitHandler(
        context,
        checkpoint,
        createStepId,
        undefined,
        undefined,
      );

      const waitPromise = waitHandler({ seconds: 5 });

      // Wait a bit for phase 1 to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify phase 1 marked as IDLE_NOT_AWAITED
      expect(checkpoint.markOperationState).toHaveBeenCalledWith(
        "1",
        "IDLE_NOT_AWAITED",
        expect.objectContaining({
          metadata: expect.objectContaining({
            stepId: "1",
            type: OperationType.WAIT,
            subType: OperationSubType.WAIT,
          }),
        }),
      );

      // Simulate status change
      context._stepData["1"] = {
        Id: "1",
        Status: OperationStatus.SUCCEEDED,
      } as any;

      // Await the promise (phase 2)
      await waitPromise;

      // Verify marked as awaited
      expect(checkpoint.markOperationAwaited).toHaveBeenCalledWith("1");

      // Verify waited for status change
      expect(checkpoint.waitForStatusChange).toHaveBeenCalledWith("1");

      // Verify marked as completed
      expect(checkpoint.markOperationState).toHaveBeenCalledWith(
        "1",
        "COMPLETED",
      );
    });

    it("should handle already completed wait", async () => {
      // Set up already completed wait
      context._stepData["1"] = {
        Id: "1",
        Status: OperationStatus.SUCCEEDED,
      } as any;

      const waitHandler = createWaitHandler(
        context,
        checkpoint,
        createStepId,
        undefined,
        undefined,
      );

      const waitPromise = waitHandler({ seconds: 5 });
      await waitPromise;

      // Should mark as completed immediately
      expect(checkpoint.markOperationState).toHaveBeenCalledWith(
        "1",
        "COMPLETED",
        expect.any(Object),
      );

      // Should not wait for status change
      expect(checkpoint.waitForStatusChange).not.toHaveBeenCalled();
    });
  });

  describe("Checkpoint calls", () => {
    it("should checkpoint START action for new wait", async () => {
      const waitHandler = createWaitHandler(
        context,
        checkpoint,
        createStepId,
        "parent-1",
        undefined,
      );

      waitHandler({ seconds: 10 });

      // Wait for phase 1
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(checkpoint.checkpoint).toHaveBeenCalledWith("1", {
        Id: "1",
        ParentId: "parent-1",
        Action: "START",
        SubType: OperationSubType.WAIT,
        Type: OperationType.WAIT,
        Name: undefined,
        WaitOptions: {
          WaitSeconds: 10,
        },
      });
    });
  });
});
