import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  type Mocked,
  type Mock,
} from "vitest";
import { createCallback } from "./callback";
import { ExecutionContext } from "../../types";
import { OperationStatus, Operation } from "../../types/wire";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { DurableInstrumentationPlugin } from "../../types/plugin";

describe("Callback Handler - plugin hooks", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: Mock;
  let checkAndUpdateReplayMode: Mock;
  let mockPlugin: Mocked<DurableInstrumentationPlugin>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = {
      getStepData: vi.fn(),
      _stepData: {},
      terminationManager: { terminate: vi.fn() },
      durableExecutionArn: "test-arn",
      isOperationUpdatedBetweenInvocation: vi.fn().mockReturnValue(false),
    } as any;
    mockCheckpoint = {
      checkpoint: vi.fn().mockResolvedValue(undefined),
      markOperationState: vi.fn(),
      markOperationAwaited: vi.fn(),
      waitForStatusChange: vi.fn().mockResolvedValue(undefined),
    } as any;
    createStepId = vi.fn().mockReturnValue("test-callback-id");
    checkAndUpdateReplayMode = vi.fn();
    mockPlugin = {
      onOperationStart: vi.fn(),
      onOperationEnd: vi.fn(),
    };
  });

  it("should call onOperationEnd on replay succeeded", async () => {
    const hashedStepId = hashId("test-callback-id");
    (mockContext as any)._stepData[hashedStepId] = {
      Id: hashedStepId,
      Status: OperationStatus.SUCCEEDED,
      CallbackDetails: { CallbackId: "cb-123", Result: "result" },
    } as Operation;
    (mockContext.getStepData as Mock).mockReturnValue(
      (mockContext as any)._stepData[hashedStepId],
    );

    const handler = createCallback(
      mockContext,
      mockCheckpoint,
      createStepId,
      checkAndUpdateReplayMode,
      undefined,
      undefined,
      mockPlugin,
    );

    await handler<string>("test-callback");

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(0);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ isReplay: true }),
    );
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.not.objectContaining({ error: expect.anything() }),
    );
  });

  it("should call onOperationEnd on replay failed", async () => {
    const hashedStepId = hashId("test-callback-id");
    (mockContext as any)._stepData[hashedStepId] = {
      Id: hashedStepId,
      Status: OperationStatus.FAILED,
      CallbackDetails: { CallbackId: "cb-456" },
    } as Operation;
    (mockContext.getStepData as Mock).mockReturnValue(
      (mockContext as any)._stepData[hashedStepId],
    );

    const handler = createCallback(
      mockContext,
      mockCheckpoint,
      createStepId,
      checkAndUpdateReplayMode,
      undefined,
      undefined,
      mockPlugin,
    );

    const result = await handler<string>("test-callback");
    const [promise] = await result;
    await expect(promise).rejects.toThrow();

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(0);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ isReplay: true }),
    );
  });

  it("should call onOperationEnd on replay timed out", async () => {
    const hashedStepId = hashId("test-callback-id");
    (mockContext as any)._stepData[hashedStepId] = {
      Id: hashedStepId,
      Status: OperationStatus.TIMED_OUT,
      CallbackDetails: { CallbackId: "cb-789" },
    } as Operation;
    (mockContext.getStepData as Mock).mockReturnValue(
      (mockContext as any)._stepData[hashedStepId],
    );

    const handler = createCallback(
      mockContext,
      mockCheckpoint,
      createStepId,
      checkAndUpdateReplayMode,
      undefined,
      undefined,
      mockPlugin,
    );

    const result = await handler<string>("test-callback");
    const [promise] = await result;
    await expect(promise).rejects.toThrow();

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(0);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ isReplay: true }),
    );
  });

  it("should call onOperationStart for new callback (phase 1 start)", async () => {
    (mockContext.getStepData as Mock).mockReturnValueOnce(null);

    (mockCheckpoint.checkpoint as Mock).mockImplementation(
      async (stepId: string) => {
        const hashedStepId = hashId(stepId);
        (mockContext as any)._stepData[hashedStepId] = {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {
            CallbackId: "new-cb-123",
          },
        } as Operation;
      },
    );

    (mockContext.getStepData as Mock).mockImplementation((stepId: string) => {
      const hashedStepId = hashId(stepId);
      return (mockContext as any)._stepData[hashedStepId];
    });

    const handler = createCallback(
      mockContext,
      mockCheckpoint,
      createStepId,
      checkAndUpdateReplayMode,
      undefined,
      undefined,
      mockPlugin,
    );

    const result = await handler<string>("new-callback");
    const [, callbackId] = await result;

    expect(callbackId).toBe("new-cb-123");
    // Phase 1 fires onOperationStart for new callback
    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationStart).toHaveBeenCalledWith(
      expect.objectContaining({ isReplay: false }),
    );
  });

  it("should not throw when plugin hooks are undefined", async () => {
    const hashedStepId = hashId("test-callback-id");
    (mockContext as any)._stepData[hashedStepId] = {
      Id: hashedStepId,
      Status: OperationStatus.SUCCEEDED,
      CallbackDetails: { CallbackId: "cb-123", Result: "result" },
    } as Operation;
    (mockContext.getStepData as Mock).mockReturnValue(
      (mockContext as any)._stepData[hashedStepId],
    );

    const handler = createCallback(
      mockContext,
      mockCheckpoint,
      createStepId,
      checkAndUpdateReplayMode,
      undefined,
      () => ({
        serialize: vi.fn(),
        deserialize: vi.fn().mockResolvedValue("deserialized-result"),
      }),
      {},
    );

    const result = await handler<string>("test-callback");
    const [promise, callbackId] = await result;
    expect(callbackId).toBe("cb-123");
    expect(await promise).toBe("deserialized-result");
  });
});
