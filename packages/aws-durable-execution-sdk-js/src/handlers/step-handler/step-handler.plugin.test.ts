import { createStepHandler } from "./step-handler";
import { ExecutionContext } from "../../types";
import { Context } from "aws-lambda";
import { createDefaultLogger } from "../../utils/logger/default-logger";
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

describe("Step Handler - plugin hooks", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let mockParentContext: Context;
  let createStepId: () => string;
  let stepIdCounter = 0;
  let mockPlugin: jest.Mocked<DurableInstrumentationPlugin>;

  beforeEach(() => {
    jest.clearAllMocks();
    stepIdCounter = 0;

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

    mockParentContext = {
      getRemainingTimeInMillis: jest.fn().mockReturnValue(30000),
    } as any;

    createStepId = (): string => `step-${++stepIdCounter}`;

    mockPlugin = {
      wrapOperationAttemptFn: jest.fn(),
    };

    (mockPlugin.wrapOperationAttemptFn as jest.Mock).mockImplementation(
      (_info: unknown, fn: () => unknown) => fn(),
    );

    mockSafeSerialize.mockImplementation(async (_serdes, value) =>
      JSON.stringify(value),
    );
    mockSafeDeserialize.mockImplementation(async (_serdes, value) =>
      value ? JSON.parse(value) : undefined,
    );
  });

  it("should call wrapOperationAttemptFn with correct AttemptInfo on success", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      mockPlugin,
    );

    const stepFn = jest.fn().mockResolvedValue("result");

    await stepHandler("my-step", stepFn);

    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenCalledTimes(1);
    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenCalledWith(
      expect.objectContaining({ Attempt: 1 }),
      expect.any(Function),
    );
  });

  it("should call wrapOperationAttemptFn when step fails without retry", async () => {
    const stepError = new Error("step blew up");
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      mockPlugin,
    );

    const stepFn = jest.fn().mockRejectedValue(stepError);

    await expect(
      stepHandler("my-step", stepFn, {
        retryStrategy: () => ({ shouldRetry: false }),
      }),
    ).rejects.toThrow();

    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenCalledTimes(1);
    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenCalledWith(
      expect.objectContaining({ Attempt: 1 }),
      expect.any(Function),
    );
  });

  it("should call wrapOperationAttemptFn on each retry attempt", async () => {
    let callCount = 0;
    const stepFn = jest.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("transient failure");
      }
      return "recovered";
    });

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      mockPlugin,
    );

    const result = await stepHandler("my-step", stepFn, {
      retryStrategy: (_error, attempt) => ({
        shouldRetry: attempt < 2,
        delay: { seconds: 0 },
      }),
    });

    expect(result).toBe("recovered");

    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenCalledTimes(2);

    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ Attempt: 1 }),
      expect.any(Function),
    );

    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ Attempt: 1 }),
      expect.any(Function),
    );
  });

  it("should propagate errors thrown within wrapOperationAttemptFn", async () => {
    const wrapError = new Error("wrapOperationAttemptFn exploded");

    (mockPlugin.wrapOperationAttemptFn as jest.Mock).mockImplementation(
      (_info: unknown, fn: () => unknown) => {
        fn();
        throw wrapError;
      },
    );

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      mockPlugin,
    );

    const stepFn = jest.fn().mockResolvedValue("result");

    await expect(
      stepHandler("my-step", stepFn, {
        retryStrategy: () => ({ shouldRetry: false }),
      }),
    ).rejects.toThrow("wrapOperationAttemptFn exploded");

    expect(stepFn).toHaveBeenCalled();
  });

  it("should not throw when plugin hooks are undefined", async () => {
    const emptyPlugin: DurableInstrumentationPlugin = {};

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      emptyPlugin,
    );

    const stepFn = jest.fn().mockResolvedValue("result");

    const result = await stepHandler("my-step", stepFn);
    expect(result).toBe("result");
  });
});
