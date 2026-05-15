import { createInvokeHandler } from "./invoke-handler";
import { ExecutionContext, DurableExecutionMode } from "../../types";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import {
  DurableInstrumentationPlugin,
  AttemptEndInfoOutcome,
} from "../../types/plugin";

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
      onOperationStart: jest.fn(),
      onOperationFirstEnd: jest.fn(),
      onOperationAttemptStart: jest.fn(),
      onOperationAttemptEnd: jest.fn(),
    };
    mockSafeSerialize.mockResolvedValue('{"serialized":"data"}');
    mockSafeDeserialize.mockResolvedValue({ result: "success" });
  });

  it("should call all plugin hooks on replay succeeded", async () => {
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
      mockPlugin,
    );

    await handler("test-function", { test: "data" });

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: AttemptEndInfoOutcome.SUCCEEDED,
      }),
    );
    expect(mockPlugin.onOperationFirstEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationFirstEnd).toHaveBeenCalledWith(
      expect.not.objectContaining({ error: expect.anything() }),
    );
  });

  it("should call all plugin hooks with error on replay failed", async () => {
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
      mockPlugin,
    );

    await expect(handler("test-function", { test: "data" })).rejects.toThrow();

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: AttemptEndInfoOutcome.FAILED,
      }),
    );
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
      mockPlugin,
      () => DurableExecutionMode.ReplayMode,
    );

    await handler("test-function", { test: "data" });

    expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
    expect(mockPlugin.onOperationAttemptStart).not.toHaveBeenCalled();
    expect(mockPlugin.onOperationAttemptEnd).not.toHaveBeenCalled();
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
      mockPlugin,
      () => DurableExecutionMode.ReplayMode,
    );

    await expect(handler("test-function", { test: "data" })).rejects.toThrow();

    expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
    expect(mockPlugin.onOperationAttemptStart).not.toHaveBeenCalled();
    expect(mockPlugin.onOperationAttemptEnd).not.toHaveBeenCalled();
    expect(mockPlugin.onOperationFirstEnd).not.toHaveBeenCalled();
  });

  it("should call plugin hooks on phase 2 succeeded", async () => {
    (mockContext.getStepData as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: { Result: '{"result":"success"}' },
      });

    const handler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      mockCreateStepId,
      undefined,
      jest.fn(),
      mockPlugin,
    );

    await handler("test-function", { test: "data" });

    // Phase 1: onOperationStart + onOperationAttemptStart
    // Phase 2: onOperationAttemptEnd + onOperationFirstEnd
    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: AttemptEndInfoOutcome.SUCCEEDED,
      }),
    );
    expect(mockPlugin.onOperationFirstEnd).toHaveBeenCalledTimes(1);
  });

  it("should call plugin hooks with error on phase 2 failed", async () => {
    (mockContext.getStepData as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
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
      mockPlugin,
    );

    await expect(handler("test-function", { test: "data" })).rejects.toThrow();

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: AttemptEndInfoOutcome.FAILED,
        error: expect.any(Error),
      }),
    );
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
      {},
    );

    const result = await handler("test-function", { test: "data" });
    expect(result).toEqual({ result: "success" });
  });
});
