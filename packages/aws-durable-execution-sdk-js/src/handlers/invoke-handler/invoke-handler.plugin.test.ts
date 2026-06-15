import { createInvokeHandler } from "./invoke-handler";
import { ExecutionContext } from "../../types";
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
      isOperationUpdatedBetweenInvocation: jest.fn().mockReturnValue(false),
    } as any;
    mockPlugin = {
      onOperationStart: jest.fn(),
      onOperationEnd: jest.fn(),
      onOperationAttemptStart: jest.fn(),
      onOperationAttemptEnd: jest.fn(),
    };
    mockSafeSerialize.mockResolvedValue('{"serialized":"data"}');
    mockSafeDeserialize.mockResolvedValue({ result: "success" });
  });

  it("should call onOperationEnd on replay succeeded", async () => {
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

    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
  });

  it("should call onOperationStart and onOperationEnd on replay failed", async () => {
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

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(0);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
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

    // Phase 1: onOperationStart (new invoke started)
    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    // Phase 2: onOperationEnd (invoke completed)
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
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

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
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
