import { createInvokeHandler } from "./invoke-handler";
import { ExecutionContext, OperationLifecycleState } from "../../types";
import { DurablePromise } from "../../types/durable-promise";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";

jest.mock("../../utils/logger/logger");
jest.mock("../../errors/serdes-errors/serdes-errors");

import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";

const mockSafeSerialize = safeSerialize as jest.MockedFunction<
  typeof safeSerialize
>;
const mockSafeDeserialize = safeDeserialize as jest.MockedFunction<
  typeof safeDeserialize
>;

describe("Invoke Handler Two-Phase Execution", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: () => string;
  let checkAndUpdateReplayMode: jest.Mock;
  let stepIdCounter = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    stepIdCounter = 0;

    mockContext = {
      getStepData: jest.fn().mockReturnValue(null),
      terminationManager: {
        terminate: jest.fn(),
      },
      durableExecutionArn: "test-arn",
    } as any;

    mockCheckpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      markOperationState: jest.fn(),
      markOperationAwaited: jest.fn(),
      waitForStatusChange: jest.fn().mockResolvedValue(undefined),
    } as any;

    createStepId = (): string => `step-${++stepIdCounter}`;
    checkAndUpdateReplayMode = jest.fn();

    mockSafeSerialize.mockResolvedValue('{"serialized":"data"}');
    mockSafeDeserialize.mockResolvedValue({ result: "success" });
  });

  it("should execute invoke logic in phase 1 without awaiting", async () => {
    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
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
    (mockContext.getStepData as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: { Result: '{"result":"data"}' },
      });

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const invokePromise = invokeHandler("test-function", { input: "data" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = await invokePromise;

    expect(result).toEqual({ result: "success" });
    expect(mockCheckpoint.markOperationAwaited).toHaveBeenCalledWith("step-1");
    expect(mockCheckpoint.waitForStatusChange).toHaveBeenCalledWith("step-1");
  });

  it("should work correctly with Promise.race", async () => {
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      ChainedInvokeDetails: { Result: '{"result":"data1"}' },
    });

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
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
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      ChainedInvokeDetails: {
        Result: '{"cached":"result"}',
      },
    });

    mockSafeDeserialize.mockResolvedValue({ cached: "result" });

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const invokePromise = invokeHandler("test-function", { input: "data" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();

    const result = await invokePromise;
    expect(result).toEqual({ cached: "result" });

    expect(mockSafeDeserialize).toHaveBeenCalledWith(
      expect.anything(),
      '{"cached":"result"}',
      "step-1",
      undefined,
      mockContext.terminationManager,
      "test-arn",
    );
  });

  it("should only checkpoint once when stepData doesn't exist", async () => {
    (mockContext.getStepData as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: { Result: '{"result":"data"}' },
      });

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const invokePromise = invokeHandler("test-function", { input: "data" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockCheckpoint.checkpoint).toHaveBeenCalledTimes(1);

    await invokePromise;

    expect(mockCheckpoint.checkpoint).toHaveBeenCalledTimes(1);
  });

  it("should mark operation as completed in phase 1 when already succeeded", async () => {
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      ChainedInvokeDetails: { Result: '{"result":"data"}' },
    });

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      undefined,
      checkAndUpdateReplayMode,
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
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Status: OperationStatus.FAILED,
      ChainedInvokeDetails: {
        Error: { ErrorMessage: "Test error" },
      },
    });

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
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
    (mockContext.getStepData as jest.Mock).mockReturnValue(null);

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const _invokePromise = invokeHandler("test-function", { input: "data" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockCheckpoint.markOperationAwaited).not.toHaveBeenCalled();

    // Don't await - just verify it hasn't been called yet
    expect(mockCheckpoint.markOperationAwaited).not.toHaveBeenCalled();
  });
});
