import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  type Mocked,
  type Mock,
} from "vitest";
import { createWaitHandler } from "./wait-handler";
import { OperationStatus } from "../../types/wire";
import { ExecutionContext } from "../../types";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { DurableInstrumentationPlugin } from "../../types/plugin";

describe("Wait Handler - plugin hooks", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: Mock;
  let mockPlugin: Mocked<DurableInstrumentationPlugin>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = {
      getStepData: vi.fn().mockReturnValue(null),
      _stepData: {},
      durableExecutionArn: "test-arn",
      terminationManager: { terminate: vi.fn() },
      isOperationUpdatedBetweenInvocation: vi.fn().mockReturnValue(false),
    } as any;
    mockCheckpoint = {
      checkpoint: vi.fn().mockResolvedValue(undefined),
      markOperationState: vi.fn(),
      markOperationAwaited: vi.fn(),
      waitForStatusChange: vi.fn().mockResolvedValue(undefined),
    } as any;
    createStepId = vi.fn().mockReturnValue("test-step-id");
    mockPlugin = {
      onOperationStart: vi.fn(),
      onOperationEnd: vi.fn(),
    };
  });

  it("should call onOperationEnd on replay succeeded", async () => {
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
      undefined,
      vi.fn(),
      mockPlugin,
    );

    await handler("test-wait", { seconds: 1 });

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(0);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ isReplay: true }),
    );
  });

  it("should call onOperationEnd on phase 2 succeeded", async () => {
    // Phase 1: not completed, checkpoint START
    // Phase 2: waitForStatusChange resolves, then SUCCEEDED
    (mockContext.getStepData as Mock)
      .mockReturnValueOnce(null) // phase 1 initial check
      .mockReturnValueOnce(null) // after checkpoint (inside !stepData branch)
      .mockReturnValueOnce(null) // refresh stepData after checkpoint
      .mockReturnValueOnce({
        // phase 2 after waitForStatusChange
        Status: OperationStatus.SUCCEEDED,
      });

    const handler = createWaitHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      undefined,
      vi.fn(),
      mockPlugin,
    );

    await handler("test-wait", { seconds: 1 });

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationStart).toHaveBeenCalledWith(
      expect.objectContaining({ isReplay: false }),
    );
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ isReplay: false }),
    );
  });

  it("should not throw when plugin hooks are undefined", async () => {
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
      undefined,
      vi.fn(),
      {},
    );

    await handler("test-wait", { seconds: 1 });
  });
});
