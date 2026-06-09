import { createWaitForConditionHandler } from "./wait-for-condition-handler";
import {
  ExecutionContext,
  WaitForConditionCheckFunc,
  WaitForConditionConfig,
  DurableLogger,
} from "../../types";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { DurableInstrumentationPlugin } from "../../types/plugin";

jest.mock("../../utils/logger/logger");
jest.mock("../../errors/serdes-errors/serdes-errors");
jest.mock("../../utils/context-tracker/context-tracker");

import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";
import { runWithContext } from "../../utils/context-tracker/context-tracker";

const mockSafeSerialize = safeSerialize as jest.MockedFunction<
  typeof safeSerialize
>;
const mockSafeDeserialize = safeDeserialize as jest.MockedFunction<
  typeof safeDeserialize
>;
const mockRunWithContext = runWithContext as jest.MockedFunction<
  typeof runWithContext
>;

describe("WaitForCondition Handler - plugin hooks", () => {
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

    createStepId = jest.fn().mockReturnValue("step-1");

    mockPlugin = {
      wrapOperationAttemptFn: jest.fn(),
    };

    mockSafeSerialize.mockImplementation(async (_serdes, value) =>
      JSON.stringify(value),
    );
    mockSafeDeserialize.mockImplementation(async (_serdes, value) =>
      value ? JSON.parse(value) : undefined,
    );

    mockRunWithContext.mockImplementation(async (_stepId, _parentId, fn) => {
      return await fn();
    });
  });

  it("should call wrapOperationAttemptFn on condition met", async () => {
    (mockPlugin.wrapOperationAttemptFn as jest.Mock).mockImplementation(
      (_info: unknown, fn: () => unknown) => fn(),
    );

    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      mockPlugin,
    );

    const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
      .fn()
      .mockResolvedValue("done");
    const config: WaitForConditionConfig<string> = {
      waitStrategy: () => ({ shouldContinue: false }),
      initialState: "start",
    };

    await handler("my-condition", checkFunc, config);

    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenCalledTimes(1);
    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenCalledWith(
      expect.objectContaining({ Attempt: 1 }),
      expect.any(Function),
    );
  });

  it("should call wrapOperationAttemptFn when check throws", async () => {
    const checkError = new Error("check blew up");

    (mockPlugin.wrapOperationAttemptFn as jest.Mock).mockImplementation(
      (_info: unknown, fn: () => unknown) => fn(),
    );

    mockRunWithContext.mockImplementationOnce(
      async (_stepId, _parentId, fn) => {
        return await fn();
      },
    );

    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      mockPlugin,
    );

    const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
      .fn()
      .mockRejectedValue(checkError);
    const config: WaitForConditionConfig<string> = {
      waitStrategy: () => ({ shouldContinue: false }),
      initialState: "start",
    };

    await expect(handler("my-condition", checkFunc, config)).rejects.toThrow();

    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenCalledTimes(1);
    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenCalledWith(
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

    mockRunWithContext.mockImplementationOnce(
      async (_stepId, _parentId, fn) => {
        return await fn();
      },
    );

    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      mockPlugin,
    );

    const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
      .fn()
      .mockResolvedValue("done");
    const config: WaitForConditionConfig<string> = {
      waitStrategy: () => ({ shouldContinue: false }),
      initialState: "start",
    };

    await expect(handler("my-condition", checkFunc, config)).rejects.toThrow(
      "wrapOperationAttemptFn exploded",
    );

    expect(checkFunc).toHaveBeenCalled();
  });

  it("should not throw when plugin hooks are undefined", async () => {
    const emptyPlugin: DurableInstrumentationPlugin = {};

    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      emptyPlugin,
    );

    const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
      .fn()
      .mockResolvedValue("done");
    const config: WaitForConditionConfig<string> = {
      waitStrategy: () => ({ shouldContinue: false }),
      initialState: "start",
    };

    const result = await handler(checkFunc, config);
    expect(result).toBe("done");
  });
});
