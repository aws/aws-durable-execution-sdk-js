import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";
import { createWaitHandler } from "./wait-handler";
import { OperationStatus } from "../../types/wire";
import { ExecutionContext, OperationLifecycleState } from "../../types";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";

vi.mock("../../utils/logger/logger");

describe("Wait Handler", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      getStepData: vi.fn().mockReturnValue(null),
      _stepData: {},
      durableExecutionArn: "test-arn",
      terminationManager: {
        terminate: vi.fn(),
      },
      isOperationUpdatedBetweenInvocation: vi.fn().mockReturnValue(false),
    } as any;

    mockCheckpoint = {
      checkpoint: vi.fn().mockResolvedValue(undefined),
      markOperationState: vi.fn(),
      markOperationAwaited: vi.fn(),
      waitForRetryTimer: vi.fn().mockResolvedValue(undefined),
    } as any;

    createStepId = vi.fn().mockReturnValue("test-step-id");
  });

  it("should skip execution if step is already completed", async () => {
    const stepData = (mockContext as any)._stepData;
    stepData[hashId("test-step-id")] = {
      Id: "test-step-id",
      Status: OperationStatus.SUCCEEDED,
    };

    (mockContext.getStepData as Mock).mockReturnValue(
      stepData[hashId("test-step-id")],
    );

    const handler = createWaitHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    await handler("test-wait", { seconds: 1 });

    expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();
    expect(mockCheckpoint.markOperationState).toHaveBeenCalledWith(
      "test-step-id",
      OperationLifecycleState.COMPLETED,
      expect.any(Object),
    );
  });

  it("should handle wait with name parameter", async () => {
    const handler = createWaitHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const _promise = handler("test-wait", { seconds: 1 });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockCheckpoint.checkpoint).toHaveBeenCalled();
  });

  it("should handle wait without name parameter", async () => {
    const handler = createWaitHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const _promise = handler({ seconds: 1 });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockCheckpoint.checkpoint).toHaveBeenCalled();
  });
});
