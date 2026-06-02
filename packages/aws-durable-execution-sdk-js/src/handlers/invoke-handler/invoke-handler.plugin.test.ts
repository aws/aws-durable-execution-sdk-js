import { createInvokeHandler } from "./invoke-handler";
import { ExecutionContext, DurableExecutionMode } from "../../types";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { DurableInstrumentationPlugin } from "../../types/plugin";

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

describe("InvokeHandler - plugin hooks", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let mockCreateStepId: jest.Mock;
  let mockPlugin: jest.Mocked<DurableInstrumentationPlugin>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateStepId = jest.fn().mockReturnValue("test-step-1");
    mockCheckpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      markOperationState: jest.fn(),
      markOperationAwaited: jest.fn(),
      waitForStatusChange: jest.fn().mockResolvedValue(undefined),
    } as any;
    mockContext = {
      getStepData: jest.fn().mockReturnValue(undefined),
      terminationManager: { terminate: jest.fn() },
      durableExecutionArn: "test-arn",
    } as any;
    mockPlugin = {
      onOperationFirstStart: jest.fn(),
      onOperationStart: jest.fn(),
      onOperationFirstEnd: jest.fn(),
      onOperationAttemptStart: jest.fn(),
      onOperationAttemptEnd: jest.fn(),
    };
    mockSafeSerialize.mockResolvedValue('{"serialized":"data"}');
    mockSafeDeserialize.mockResolvedValue({ result: "success" });
  });

  it("should call onOperationFirstEnd on replay succeeded", async () => {
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      ChainedInvokeDetails: { Result: '{"result":"success"}' },
    });

    const handler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      mockCreateStepId,
      undefined,
      jest.fn(),
      undefined,
      mockPlugin,
    );

    await handler("test-function", { test: "data" });

    expect(mockPlugin.onOperationFirstEnd).toHaveBeenCalledTimes(1);
  });

  it("should call onOperationStart and onOperationFirstEnd on replay failed", async () => {
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Status: OperationStatus.FAILED,
      ChainedInvokeDetails: {
        Error: { ErrorMessage: "invoke failed" },
      },
    });

    const handler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      mockCreateStepId,
      undefined,
      jest.fn(),
      undefined,
      mockPlugin,
    );

    await expect(handler("test-function", { test: "data" })).rejects.toThrow();

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationFirstEnd).toHaveBeenCalledTimes(1);
  });

  it("should skip plugin calls in full replay mode on replay succeeded", async () => {
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      ChainedInvokeDetails: { Result: '{"result":"success"}' },
    });

    const handler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      mockCreateStepId,
      undefined,
      jest.fn(),
      undefined,
      mockPlugin,
      () => DurableExecutionMode.ReplayMode,
    );

    await handler("test-function", { test: "data" });

    expect(mockPlugin.onOperationFirstStart).not.toHaveBeenCalled();
    expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
    expect(mockPlugin.onOperationFirstEnd).not.toHaveBeenCalled();
  });

  it("should skip plugin calls in full replay mode on replay failed", async () => {
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Status: OperationStatus.FAILED,
      ChainedInvokeDetails: {
        Error: { ErrorMessage: "invoke failed" },
      },
    });

    const handler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      mockCreateStepId,
      undefined,
      jest.fn(),
      undefined,
      mockPlugin,
      () => DurableExecutionMode.ReplayMode,
    );

    await expect(handler("test-function", { test: "data" })).rejects.toThrow();

    expect(mockPlugin.onOperationFirstStart).not.toHaveBeenCalled();
    expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
    expect(mockPlugin.onOperationFirstEnd).not.toHaveBeenCalled();
  });

  it("should call plugin hooks on phase 2 succeeded", async () => {
    (mockContext.getStepData as jest.Mock)
      .mockReturnValueOnce(undefined) // phase 1: no existing step data → triggers checkpoint
      .mockReturnValueOnce(undefined) // phase 1: getStepData after checkpoint (for toOperationInfo)
      .mockReturnValueOnce({
        // phase 2: after waitForStatusChange
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: { Result: '{"result":"success"}' },
      });

    const handler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      mockCreateStepId,
      undefined,
      jest.fn(),
      undefined,
      mockPlugin,
    );

    await handler("test-function", { test: "data" });

    // Phase 1: onOperationFirstStart (new invoke started)
    expect(mockPlugin.onOperationFirstStart).toHaveBeenCalledTimes(1);
    // Phase 2: onOperationFirstEnd (invoke completed)
    expect(mockPlugin.onOperationFirstEnd).toHaveBeenCalledTimes(1);
  });

  it("should call plugin hooks with error on phase 2 failed", async () => {
    (mockContext.getStepData as jest.Mock)
      .mockReturnValueOnce(undefined) // phase 1: no existing step data → triggers checkpoint
      .mockReturnValueOnce(undefined) // phase 1: getStepData after checkpoint (for toOperationInfo)
      .mockReturnValueOnce({
        // phase 2: after waitForStatusChange
        Status: OperationStatus.FAILED,
        ChainedInvokeDetails: {
          Error: { ErrorMessage: "invoke failed" },
        },
      });

    const handler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      mockCreateStepId,
      undefined,
      jest.fn(),
      undefined,
      mockPlugin,
    );

    await expect(handler("test-function", { test: "data" })).rejects.toThrow();

    expect(mockPlugin.onOperationFirstStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationFirstEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationFirstEnd).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it("should not throw when plugin hooks are undefined", async () => {
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      ChainedInvokeDetails: { Result: '{"result":"success"}' },
    });

    const handler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      mockCreateStepId,
      undefined,
      jest.fn(),
      undefined,
      {},
    );

    const result = await handler("test-function", { test: "data" });
    expect(result).toEqual({ result: "success" });
  });
});
