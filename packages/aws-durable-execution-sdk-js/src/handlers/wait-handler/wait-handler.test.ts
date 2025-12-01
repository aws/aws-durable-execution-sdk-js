import { createWaitHandler } from "./wait-handler";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { ExecutionContext, OperationLifecycleState } from "../../types";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";

jest.mock("../../utils/logger/logger");

describe("Wait Handler", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      getStepData: jest.fn().mockReturnValue(null),
      _stepData: {},
      durableExecutionArn: "test-arn",
      terminationManager: {
        terminate: jest.fn(),
      },
    } as any;

    mockCheckpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      markOperationState: jest.fn(),
      markOperationAwaited: jest.fn(),
      waitForRetryTimer: jest.fn().mockResolvedValue(undefined),
    } as any;

    createStepId = jest.fn().mockReturnValue("test-step-id");
  });

  it("should skip execution if step is already completed", async () => {
    const stepData = (mockContext as any)._stepData;
    stepData[hashId("test-step-id")] = {
      Id: "test-step-id",
      Status: OperationStatus.SUCCEEDED,
    };

    (mockContext.getStepData as jest.Mock).mockReturnValue(
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
