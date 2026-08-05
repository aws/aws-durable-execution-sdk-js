import { createStepHandler } from "./step-handler";
import { ExecutionContext } from "../../types";
import { Context } from "aws-lambda";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import {
  DurableInstrumentationPlugin,
  AttemptEndInfoOutcome,
} from "../../types/plugin";
import { OperationStatus } from "../../types/wire";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

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
      onOperationAttemptStart: jest.fn(),
      onOperationAttemptEnd: jest.fn(),
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

  it("should call onOperationAttemptStart and onOperationAttemptEnd with succeeded outcome on success", async () => {
    const beforeTime = new Date();
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
    const afterTime = new Date();

    expect(mockPlugin.onOperationAttemptStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationAttemptStart).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, isReplay: false }),
    );

    // Verify startTimestamp is the current time, not from stepData
    const attemptInfo = (mockPlugin.onOperationAttemptStart as jest.Mock).mock
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

  it("should call onOperationAttemptEnd with failed outcome when step fails without retry", async () => {
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
        error: stepError,
      }),
    );
  });

  it("should call onOperationAttemptEnd with failed outcome when step fails and will retry", async () => {
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

    // First attempt: start + failed end
    // Second attempt: start + succeeded end
    expect(mockPlugin.onOperationAttemptStart).toHaveBeenCalledTimes(2);
    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenCalledTimes(2);
    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenCalledTimes(2);

    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ attempt: 1, isReplay: false }),
      expect.any(Function),
    );

    expect(mockPlugin.wrapOperationAttemptFn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ attempt: 1, isReplay: false }),
      expect.any(Function),
    );

    expect(mockPlugin.onOperationAttemptEnd).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        isReplay: false,
        outcome: AttemptEndInfoOutcome.FAILED,
        error: expect.any(Error),
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

  it("should call onOperationStart with isReplay true on subsequent retry attempts", async () => {
    const stepId = "step-1";
    const hashedStepId = hashId(stepId);

    // Track getStepData calls to return appropriate state at each point
    // in the retry lifecycle.
    // The default semantics is AtLeastOncePerRetry:
    //   executeStepLogic call 1:
    //     1. top of executeStepLogic: null (not started yet)
    //     2. try block (computing currentAttempt): null (Attempt 0 → currentAttempt=1)
    //     3. catch block (computing currentAttempt after error): null
    //     4. after RETRY checkpoint: { Attempt: 1 }
    //     5. for NextAttemptTimestamp: { Attempt: 1 }
    //   waitForRetryTimer resolves, then executeStepLogic call 2:
    //     6. top of executeStepLogic: { Attempt: 1, Status: PENDING } — not STARTED
    //     7. try block (computing currentAttempt): { Attempt: 1 }
    //     8. after SUCCEED checkpoint: { Status: SUCCEEDED, Attempt: 1 }
    let getStepDataCallCount = 0;
    (mockContext.getStepData as jest.Mock).mockImplementation(() => {
      getStepDataCallCount++;
      if (getStepDataCallCount <= 3) {
        return null;
      }
      if (getStepDataCallCount <= 7) {
        return {
          Id: hashedStepId,
          Status: OperationStatus.PENDING,
          StepDetails: {
            Attempt: 1,
          },
        };
      }
      return {
        Id: hashedStepId,
        Status: OperationStatus.SUCCEEDED,
        StepDetails: {
          Attempt: 1,
          Result: JSON.stringify("recovered"),
        },
      };
    });

    mockPlugin.onOperationStart = jest.fn();

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
        shouldRetry: attempt < 3,
        delay: { seconds: 0 },
      }),
    });

    expect(result).toBe("recovered");

    // onOperationStart should be called twice:
    // 1st: isReplay false (first attempt, Attempt=0 from null)
    // 2nd: isReplay true (retry attempt, Attempt=1)
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
