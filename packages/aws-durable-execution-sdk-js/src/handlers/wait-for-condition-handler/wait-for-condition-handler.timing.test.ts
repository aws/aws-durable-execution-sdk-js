import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  type MockedFunction,
  type Mock,
} from "vitest";
import { createWaitForConditionHandler } from "./wait-for-condition-handler";
import {
  DurableLogger,
  ExecutionContext,
  WaitForConditionCheckFunc,
  WaitForConditionConfig,
  OperationLifecycleState,
} from "../../types";
import { OperationStatus } from "../../types/wire";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";

vi.mock("../../utils/logger/logger");
vi.mock("../../errors/serdes-errors/serdes-errors");

import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";

const mockSafeSerialize = safeSerialize as MockedFunction<typeof safeSerialize>;
const mockSafeDeserialize = safeDeserialize as MockedFunction<
  typeof safeDeserialize
>;

describe("WaitForCondition Handler Timing Tests", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      getStepData: vi.fn().mockReturnValue(null),
      _stepData: {},
      durableExecutionArn: "test-arn",
      terminationManager: {
        terminate: vi.fn(),
      },
    } as any;

    mockCheckpoint = {
      checkpoint: vi.fn().mockResolvedValue(undefined),
      markOperationState: vi.fn(),
      markOperationAwaited: vi.fn(),
      waitForRetryTimer: vi.fn().mockResolvedValue(undefined),
    } as any;

    createStepId = vi.fn().mockReturnValue("test-step-id");

    mockSafeSerialize.mockImplementation(async (_serdes, value) =>
      JSON.stringify(value),
    );
    mockSafeDeserialize.mockImplementation(async (_serdes, value) =>
      value ? JSON.parse(value) : undefined,
    );
  });

  it("should handle retry with scheduled delay", async () => {
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);
    const nextAttemptTime = new Date(Date.now() + 1000);

    let callCount = 0;
    (mockContext.getStepData as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          Id: hashedStepId,
          Status: OperationStatus.PENDING,
          StepDetails: {
            Attempt: 1,
            NextAttemptTimestamp: nextAttemptTime,
          },
        };
      }
      return null;
    });

    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
    );

    const checkFn: WaitForConditionCheckFunc<{ count: number }, DurableLogger> =
      vi.fn().mockResolvedValue({ count: 1 });

    const config: WaitForConditionConfig<{ count: number }> = {
      initialState: { count: 0 },
      waitStrategy: () => ({ shouldContinue: false }),
    };

    const result = await handler(checkFn, config);

    expect(result).toEqual({ count: 1 });
    expect(mockCheckpoint.markOperationState).toHaveBeenCalledWith(
      stepId,
      OperationLifecycleState.RETRY_WAITING,
      expect.objectContaining({
        endTimestamp: nextAttemptTime,
      }),
    );
    expect(mockCheckpoint.waitForRetryTimer).toHaveBeenCalledWith(stepId);
  });

  it("should execute check function after retry timer", async () => {
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);

    let callCount = 0;
    (mockContext.getStepData as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          Id: hashedStepId,
          Status: OperationStatus.PENDING,
          StepDetails: {
            NextAttemptTimestamp: new Date(Date.now() + 100),
          },
        };
      }
      return null;
    });

    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
    );

    const checkFn: WaitForConditionCheckFunc<
      { progress: number },
      DurableLogger
    > = vi.fn().mockResolvedValue({ progress: 100 });

    const config: WaitForConditionConfig<{ progress: number }> = {
      initialState: { progress: 0 },
      waitStrategy: () => ({ shouldContinue: false }),
    };

    const result = await handler(checkFn, config);

    expect(result).toEqual({ progress: 100 });
    expect(checkFn).toHaveBeenCalled();
    expect(mockCheckpoint.waitForRetryTimer).toHaveBeenCalled();
  });

  it("should handle multiple retry iterations", async () => {
    const stepId = "test-step-id";
    const hashedStepId = hashId(stepId);

    let callCount = 0;
    (mockContext.getStepData as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          Id: hashedStepId,
          Status: OperationStatus.PENDING,
          StepDetails: {
            NextAttemptTimestamp: new Date(Date.now() + 50),
          },
        };
      }
      return null;
    });

    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
    );

    let checkCallCount = 0;
    const checkFn: WaitForConditionCheckFunc<
      { attempts: number },
      DurableLogger
    > = vi.fn().mockImplementation(async () => {
      checkCallCount++;
      return { attempts: checkCallCount };
    });

    const waitStrategy = vi
      .fn()
      .mockReturnValueOnce({ shouldContinue: true, delay: { milliseconds: 1 } })
      .mockReturnValue({ shouldContinue: false });

    const config: WaitForConditionConfig<{ attempts: number }> = {
      initialState: { attempts: 0 },
      waitStrategy,
    };

    const result = await handler(checkFn, config);

    expect(result.attempts).toBeGreaterThan(0);
    expect(checkFn).toHaveBeenCalled();
    expect(mockCheckpoint.waitForRetryTimer).toHaveBeenCalled();
  });
});
