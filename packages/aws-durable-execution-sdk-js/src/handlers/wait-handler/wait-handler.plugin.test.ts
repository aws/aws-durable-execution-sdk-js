import { createWaitHandler } from "./wait-handler";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { ExecutionContext } from "../../types";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { DurableInstrumentationPlugin } from "../../types/plugin";

jest.mock("../../utils/logger/logger");

describe("Wait Handler - plugin hooks", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: jest.Mock;
  let mockPlugin: jest.Mocked<DurableInstrumentationPlugin>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockContext = {
      getStepData: jest.fn().mockReturnValue(null),
      _stepData: {},
      durableExecutionArn: "test-arn",
      terminationManager: { terminate: jest.fn() },
    } as any;
    mockCheckpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      markOperationState: jest.fn(),
      markOperationAwaited: jest.fn(),
      waitForStatusChange: jest.fn().mockResolvedValue(undefined),
    } as any;
    createStepId = jest.fn().mockReturnValue("test-step-id");
    mockPlugin = {
      onOperationStart: jest.fn(),
      onOperationEnd: jest.fn(),
    };
  });

  it("should call onOperationStart and onOperationEnd on replay succeeded", async () => {
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
      undefined,
      jest.fn(),
      mockPlugin,
    );

    await handler("test-wait", { seconds: 1 });

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
  });

  it("should call onOperationEnd on phase 2 succeeded", async () => {
    // Phase 1: not completed, checkpoint START
    // Phase 2: waitForStatusChange resolves, then SUCCEEDED
    (mockContext.getStepData as jest.Mock)
      .mockReturnValueOnce(null) // phase 1 initial check
      .mockReturnValueOnce(null) // after checkpoint refresh
      .mockReturnValueOnce({
        // phase 2 after waitForStatusChange
        Status: OperationStatus.SUCCEEDED,
      });

    const handler = createWaitHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      undefined,
      jest.fn(),
      mockPlugin,
    );

    await handler("test-wait", { seconds: 1 });

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
  });

  it("should not throw when plugin hooks are undefined", async () => {
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
      undefined,
      jest.fn(),
      {},
    );

    await handler("test-wait", { seconds: 1 });
  });
});
