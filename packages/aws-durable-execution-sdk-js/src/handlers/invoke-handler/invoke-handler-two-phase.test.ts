import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";
import { createInvokeHandler } from "./invoke-handler";
import { ExecutionContext, OperationLifecycleState } from "../../types";
import { DurablePromise } from "../../types/durable-promise";
import { OperationStatus } from "../../types/wire";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";

// A fake Serdes. The handler passes it to the real safeSerialize and
// safeDeserialize, so the tests stub and assert on its methods.
let fakeSerdes: { serialize: Mock; deserialize: Mock };
const getFakeSerdes = () => fakeSerdes;

describe("Invoke Handler Two-Phase Execution", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: () => string;
  let checkAndUpdateReplayMode: Mock;
  let stepIdCounter = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeSerdes = { serialize: vi.fn(), deserialize: vi.fn() };
    stepIdCounter = 0;

    mockContext = {
      getStepData: vi.fn().mockReturnValue(null),
      terminationManager: {
        terminate: vi.fn(),
        isTerminationRequested: vi.fn().mockReturnValue(false),
      },
      durableExecutionArn: "test-arn",
      isOperationUpdatedBetweenInvocation: vi.fn().mockReturnValue(false),
    } as any;

    mockCheckpoint = {
      checkpoint: vi.fn().mockResolvedValue(undefined),
      markOperationState: vi.fn(),
      markOperationAwaited: vi.fn(),
      waitForStatusChange: vi.fn().mockResolvedValue(undefined),
    } as any;

    createStepId = (): string => `step-${++stepIdCounter}`;
    checkAndUpdateReplayMode = vi.fn();

    fakeSerdes.serialize.mockResolvedValue('{"serialized":"data"}');
    fakeSerdes.deserialize.mockResolvedValue({ result: "success" });
  });

  it("should execute invoke logic in phase 1 without awaiting", async () => {
    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      undefined,
      undefined,
      getFakeSerdes,
    );

    const invokePromise = invokeHandler("test-function", { input: "data" });

    // Wait for phase 1 to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(invokePromise).toBeInstanceOf(DurablePromise);
    expect(mockCheckpoint.checkpoint).toHaveBeenCalled();
    expect(mockContext.getStepData).toHaveBeenCalled();
    expect(mockCheckpoint.markOperationState).toHaveBeenCalledWith(
      "step-1",
      OperationLifecycleState.IDLE_NOT_AWAITED,
      expect.any(Object),
    );
  });

  it("should execute invoke logic again in phase 2 when awaited", async () => {
    (mockContext.getStepData as Mock)
      .mockReturnValueOnce(null)
      .mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: { Result: '{"result":"data"}' },
      });

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      undefined,
      undefined,
      getFakeSerdes,
    );

    const invokePromise = invokeHandler("test-function", { input: "data" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = await invokePromise;

    expect(result).toEqual({ result: "success" });
    expect(mockCheckpoint.markOperationAwaited).toHaveBeenCalledWith("step-1");
    expect(mockCheckpoint.waitForStatusChange).toHaveBeenCalledWith("step-1");
  });

  it("should work correctly with Promise.race", async () => {
    (mockContext.getStepData as Mock).mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      ChainedInvokeDetails: { Result: '{"result":"data1"}' },
    });

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      undefined,
      undefined,
      getFakeSerdes,
    );

    const invoke1 = invokeHandler("function1", { input: "data1" });
    const invoke2 = invokeHandler("function2", { input: "data2" });

    expect((invoke1 as DurablePromise<any>).isExecuted).toBe(false);
    expect((invoke2 as DurablePromise<any>).isExecuted).toBe(false);

    const result = await Promise.race([invoke1, invoke2]);

    expect(result).toEqual({ result: "success" });
    const executed =
      (invoke1 as DurablePromise<any>).isExecuted ||
      (invoke2 as DurablePromise<any>).isExecuted;
    expect(executed).toBe(true);
  });

  it("should return cached result without re-execution when stepData exists", async () => {
    (mockContext.getStepData as Mock).mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      ChainedInvokeDetails: {
        Result: '{"cached":"result"}',
      },
    });

    fakeSerdes.deserialize.mockResolvedValue({ cached: "result" });

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      undefined,
      undefined,
      getFakeSerdes,
    );

    const invokePromise = invokeHandler("test-function", { input: "data" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();

    const result = await invokePromise;
    expect(result).toEqual({ cached: "result" });

    expect(fakeSerdes.deserialize).toHaveBeenCalledWith('{"cached":"result"}', {
      entityId: "step-1",
      durableExecutionArn: "test-arn",
    });
  });

  it("should only checkpoint once when stepData doesn't exist", async () => {
    (mockContext.getStepData as Mock)
      .mockReturnValueOnce(null)
      .mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: { Result: '{"result":"data"}' },
      });

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      undefined,
      undefined,
      getFakeSerdes,
    );

    const invokePromise = invokeHandler("test-function", { input: "data" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockCheckpoint.checkpoint).toHaveBeenCalledTimes(1);

    await invokePromise;

    expect(mockCheckpoint.checkpoint).toHaveBeenCalledTimes(1);
  });

  it("should mark operation as completed in phase 1 when already succeeded", async () => {
    (mockContext.getStepData as Mock).mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      ChainedInvokeDetails: { Result: '{"result":"data"}' },
    });

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      undefined,
      checkAndUpdateReplayMode,
      getFakeSerdes,
    );

    const invokePromise = invokeHandler("test-function", { input: "data" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockCheckpoint.markOperationState).toHaveBeenCalledWith(
      "step-1",
      OperationLifecycleState.COMPLETED,
      expect.any(Object),
    );
    expect(checkAndUpdateReplayMode).toHaveBeenCalled();

    await invokePromise;

    expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();
  });

  it("should mark operation as completed in phase 1 when already failed", async () => {
    (mockContext.getStepData as Mock).mockReturnValue({
      Status: OperationStatus.FAILED,
      ChainedInvokeDetails: {
        Error: { ErrorMessage: "Test error" },
      },
    });

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      undefined,
      undefined,
      getFakeSerdes,
    );

    const invokePromise = invokeHandler("test-function", { input: "data" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockCheckpoint.markOperationState).toHaveBeenCalledWith(
      "step-1",
      OperationLifecycleState.COMPLETED,
      expect.any(Object),
    );

    await expect(invokePromise).rejects.toThrow("Test error");
  });

  it("should not mark as awaited until phase 2 is triggered", async () => {
    (mockContext.getStepData as Mock).mockReturnValue(null);

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      undefined,
      undefined,
      getFakeSerdes,
    );

    const _invokePromise = invokeHandler("test-function", { input: "data" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockCheckpoint.markOperationAwaited).not.toHaveBeenCalled();

    // Don't await - just verify it hasn't been called yet
    expect(mockCheckpoint.markOperationAwaited).not.toHaveBeenCalled();
  });
});
