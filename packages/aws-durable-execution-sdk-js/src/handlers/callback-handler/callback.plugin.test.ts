import { createCallback } from "./callback";
import { ExecutionContext } from "../../types";
import { OperationStatus, Operation } from "@aws-sdk/client-lambda";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { DurableInstrumentationPlugin } from "../../types/plugin";

jest.mock("../../utils/logger/logger");
jest.mock("../../errors/serdes-errors/serdes-errors");

import { safeDeserialize } from "../../errors/serdes-errors/serdes-errors";

const mockSafeDeserialize = safeDeserialize as jest.MockedFunction<
  typeof safeDeserialize
>;

describe("Callback Handler - plugin hooks", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: jest.Mock;
  let checkAndUpdateReplayMode: jest.Mock;
  let mockPlugin: jest.Mocked<DurableInstrumentationPlugin>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockContext = {
      getStepData: jest.fn(),
      _stepData: {},
      terminationManager: { terminate: jest.fn() },
      durableExecutionArn: "test-arn",
      isOperationUpdatedBetweenInvocation: jest.fn().mockReturnValue(false),
    } as any;
    mockCheckpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      markOperationState: jest.fn(),
      markOperationAwaited: jest.fn(),
      waitForStatusChange: jest.fn().mockResolvedValue(undefined),
    } as any;
    createStepId = jest.fn().mockReturnValue("test-callback-id");
    checkAndUpdateReplayMode = jest.fn();
    mockPlugin = {
      onOperationStart: jest.fn(),
      onOperationEnd: jest.fn(),
    };
    mockSafeDeserialize.mockResolvedValue("deserialized-result");
  });

  it("should call all plugin hooks on replay succeeded", async () => {
    const hashedStepId = hashId("test-callback-id");
    (mockContext as any)._stepData[hashedStepId] = {
      Id: hashedStepId,
      Status: OperationStatus.SUCCEEDED,
      CallbackDetails: { CallbackId: "cb-123", Result: "result" },
    } as Operation;
    (mockContext.getStepData as jest.Mock).mockReturnValue(
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

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.not.objectContaining({ error: expect.anything() }),
    );
  });

  it("should call all plugin hooks on replay failed", async () => {
    const hashedStepId = hashId("test-callback-id");
    (mockContext as any)._stepData[hashedStepId] = {
      Id: hashedStepId,
      Status: OperationStatus.FAILED,
      CallbackDetails: { CallbackId: "cb-456" },
    } as Operation;
    (mockContext.getStepData as jest.Mock).mockReturnValue(
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

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
  });

  it("should call all plugin hooks on replay timed out", async () => {
    const hashedStepId = hashId("test-callback-id");
    (mockContext as any)._stepData[hashedStepId] = {
      Id: hashedStepId,
      Status: OperationStatus.TIMED_OUT,
      CallbackDetails: { CallbackId: "cb-789" },
    } as Operation;
    (mockContext.getStepData as jest.Mock).mockReturnValue(
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

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
  });

  it("should call plugin hooks for new callback (phase 1 start)", async () => {
    (mockContext.getStepData as jest.Mock).mockReturnValueOnce(null);

    (mockCheckpoint.checkpoint as jest.Mock).mockImplementation(
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

    (mockContext.getStepData as jest.Mock).mockImplementation(
      (stepId: string) => {
        const hashedStepId = hashId(stepId);
        return (mockContext as any)._stepData[hashedStepId];
      },
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

    const result = await handler<string>("new-callback");
    const [, callbackId] = await result;

    expect(callbackId).toBe("new-cb-123");
    // Phase 1 fires onOperationStart for new callback
    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
  });

  it("should not throw when plugin hooks are undefined", async () => {
    const hashedStepId = hashId("test-callback-id");
    (mockContext as any)._stepData[hashedStepId] = {
      Id: hashedStepId,
      Status: OperationStatus.SUCCEEDED,
      CallbackDetails: { CallbackId: "cb-123", Result: "result" },
    } as Operation;
    (mockContext.getStepData as jest.Mock).mockReturnValue(
      (mockContext as any)._stepData[hashedStepId],
    );

    const handler = createCallback(
      mockContext,
      mockCheckpoint,
      createStepId,
      checkAndUpdateReplayMode,
      undefined,
      undefined,
      {},
    );

    const result = await handler<string>("test-callback");
    const [promise, callbackId] = await result;
    expect(callbackId).toBe("cb-123");
    expect(await promise).toBe("deserialized-result");
  });
});
