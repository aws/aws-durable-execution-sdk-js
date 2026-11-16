import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  type Mocked,
  type Mock,
} from "vitest";
import { createWaitForConditionHandler } from "./wait-for-condition-handler";
import {
  ExecutionContext,
  WaitForConditionCheckFunc,
  WaitForConditionConfig,
  DurableLogger,
} from "../../types";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import {
  DurableInstrumentationPlugin,
  AttemptEndInfoOutcome,
} from "../../types/plugin";
import { OperationStatus } from "../../types/wire";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

describe("WaitForCondition Handler - plugin hooks", () => {
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
      terminationManager: {
        terminate: vi.fn(),
        isTerminationRequested: vi.fn().mockReturnValue(false),
      },
    } as any;

    mockCheckpoint = {
      checkpoint: vi.fn().mockResolvedValue(undefined),
      markOperationState: vi.fn(),
      markOperationAwaited: vi.fn(),
      waitForRetryTimer: vi.fn().mockResolvedValue(undefined),
    } as any;

    createStepId = vi.fn().mockReturnValue("step-1");

    mockPlugin = {
      onOperationAttemptStart: vi.fn(),
      onOperationAttemptEnd: vi.fn(),
      wrapOperationAttemptFn: vi.fn(),
    };
  });

  it("should call onOperationAttemptStart and onOperationAttemptEnd with succeeded on condition met", async () => {
    (mockPlugin.wrapOperationAttemptFn as Mock).mockImplementation(
      (_info: unknown, fn: () => unknown) => fn(),
    );

    const beforeTime = new Date();
    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      mockPlugin,
    );

    const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = vi
      .fn()
      .mockResolvedValue("done");
    const config: WaitForConditionConfig<string> = {
      waitStrategy: () => ({ shouldContinue: false }),
      initialState: "start",
    };

    await handler("my-condition", checkFunc, config);
    const afterTime = new Date();

    expect(mockPlugin.onOperationAttemptStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptStart).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, isReplay: false }),
    );

    // Verify startTimestamp is the current time, not from stepData
    const attemptInfo = (mockPlugin.onOperationAttemptStart as Mock).mock
      .calls[0][0];
    expect(attemptInfo.startTimestamp).toBeInstanceOf(Date);
    expect(attemptInfo.startTimestamp.getTime()).toBeGreaterThanOrEqual(
      beforeTime.getTime(),
    );
    expect(attemptInfo.startTimestamp.getTime()).toBeLessThanOrEqual(
      afterTime.getTime(),
    );

    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenCalledTimes(1);
    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, isReplay: false }),
      expect.any(Function),
    );

    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        isReplay: false,
        outcome: AttemptEndInfoOutcome.SUCCEEDED,
      }),
    );
  });

  it("should call onOperationAttemptEnd with failed when check throws", async () => {
    const checkError = new Error("check blew up");

    (mockPlugin.wrapOperationAttemptFn as Mock).mockImplementation(
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

    const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = vi
      .fn()
      .mockRejectedValue(checkError);
    const config: WaitForConditionConfig<string> = {
      waitStrategy: () => ({ shouldContinue: false }),
      initialState: "start",
    };

    await expect(handler("my-condition", checkFunc, config)).rejects.toThrow();

    expect(mockPlugin.onOperationAttemptStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenCalledTimes(1);
    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, isReplay: false }),
      expect.any(Function),
    );
    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        isReplay: false,
        outcome: AttemptEndInfoOutcome.FAILED,
        error: checkError,
      }),
    );
  });

  it("should call onOperationAttemptEnd with succeeded when condition not yet met (check ran successfully)", async () => {
    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      mockPlugin,
    );

    (mockPlugin.wrapOperationAttemptFn as Mock).mockImplementation(
      (_info: unknown, fn: () => unknown) => fn(),
    );

    let callCount = 0;
    const checkFunc: WaitForConditionCheckFunc<number, DurableLogger> = vi.fn(
      async () => ++callCount,
    );
    const config: WaitForConditionConfig<number> = {
      waitStrategy: vi
        .fn()
        .mockReturnValueOnce({
          shouldContinue: true,
          delay: { seconds: 5 },
        })
        .mockReturnValue({ shouldContinue: false }),
      initialState: 0,
    };

    await handler("my-condition", checkFunc, config);

    // First attempt: start + succeeded end (check ran successfully, condition continues)
    // Second attempt: start + succeeded end (check ran successfully, condition done)
    expect(mockPlugin.onOperationAttemptStart).toHaveBeenCalledTimes(2);
    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenCalledTimes(2);

    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        isReplay: false,
        outcome: AttemptEndInfoOutcome.SUCCEEDED,
      }),
    );

    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        isReplay: false,
        outcome: AttemptEndInfoOutcome.SUCCEEDED,
      }),
    );
  });

  it("should propagate errors thrown within wrapOperationAttemptFn", async () => {
    const wrapError = new Error("wrapOperationAttemptFn exploded");

    (mockPlugin.wrapOperationAttemptFn as Mock).mockImplementation(
      (_info: unknown, fn: () => unknown) => {
        fn();
        throw wrapError;
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

    const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = vi
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

    const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = vi
      .fn()
      .mockResolvedValue("done");
    const config: WaitForConditionConfig<string> = {
      waitStrategy: () => ({ shouldContinue: false }),
      initialState: "start",
    };

    const result = await handler(checkFunc, config);
    expect(result).toBe("done");
  });

  it("should call onOperationStart with isReplay true on subsequent retry attempts", async () => {
    const stepId = "step-1";
    const hashedStepId = hashId(stepId);

    // Simulate the getStepData progression:
    // 1st call (top of executeCheckLogic, first attempt): null (not started)
    // After RETRY checkpoint and re-entering executeCheckLogic via recursion:
    // subsequent calls return data with Attempt: 1 and status STARTED
    let getStepDataCallCount = 0;
    (mockContext.getStepData as Mock).mockImplementation(() => {
      getStepDataCallCount++;
      if (getStepDataCallCount <= 2) {
        // First attempt: no step data
        return null;
      }
      // After RETRY checkpoint: return data indicating a retry with Attempt: 1
      // Status STARTED means the operation was already started (enters isReplay: true branch)
      return {
        Id: hashedStepId,
        Status: OperationStatus.STARTED,
        StepDetails: {
          Attempt: 1,
          Result: JSON.stringify("state-after-first-attempt"),
        },
      };
    });

    (mockPlugin.wrapOperationAttemptFn as Mock).mockImplementation(
      (_info: unknown, fn: () => unknown) => fn(),
    );
    mockPlugin.onOperationStart = vi.fn();

    let checkCallCount = 0;

    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      mockPlugin,
    );

    const checkFunc: WaitForConditionCheckFunc<number, DurableLogger> = vi.fn(
      async () => ++checkCallCount,
    );
    const config: WaitForConditionConfig<number> = {
      waitStrategy: vi
        .fn()
        .mockReturnValueOnce({
          shouldContinue: true,
          delay: { seconds: 5 },
        })
        .mockReturnValue({ shouldContinue: false }),
      initialState: 0,
    };

    await handler("my-condition", checkFunc, config);

    // onOperationStart should be called twice:
    // 1st: isReplay false (first attempt, Attempt=0)
    // 2nd: isReplay true (second attempt, status is STARTED so enters the else branch)
    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(2);
    expect(mockPlugin.onOperationStart).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ isReplay: false }),
    );
    expect(mockPlugin.onOperationStart).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ isReplay: true }),
    );
  });
});
