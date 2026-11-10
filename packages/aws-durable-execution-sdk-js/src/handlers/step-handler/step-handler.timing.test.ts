import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  type MockedFunction,
  type Mock,
} from "vitest";
import { createStepHandler } from "./step-handler";
import { ExecutionContext, OperationLifecycleState } from "../../types";
import { OperationStatus } from "../../types/wire";
import { Context } from "aws-lambda";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

vi.mock("../../errors/serdes-errors/serdes-errors");

import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";

const mockSafeSerialize = safeSerialize as MockedFunction<typeof safeSerialize>;
const mockSafeDeserialize = safeDeserialize as MockedFunction<
  typeof safeDeserialize
>;

describe("Step Handler Timing Tests", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let mockParentContext: Context;
  let createStepId: () => string;
  let stepIdCounter = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    stepIdCounter = 0;

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

    mockParentContext = {
      getRemainingTimeInMillis: vi.fn().mockReturnValue(30000),
    } as any;

    createStepId = (): string => `step-${++stepIdCounter}`;

    mockSafeSerialize.mockImplementation(async (_serdes, value) =>
      JSON.stringify(value),
    );
    mockSafeDeserialize.mockImplementation(async (_serdes, value) =>
      value ? JSON.parse(value) : undefined,
    );
  });

  it("should handle retry with scheduled delay", async () => {
    const stepId = "step-1";
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
      } else {
        return null; // After retry timer, proceed with execution
      }
    });

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = vi.fn().mockResolvedValue("retry-result");

    const result = await stepHandler("test-step", stepFn);

    expect(result).toBe("retry-result");
    expect(mockCheckpoint.markOperationState).toHaveBeenCalledWith(
      stepId,
      OperationLifecycleState.RETRY_WAITING,
      expect.objectContaining({
        endTimestamp: nextAttemptTime,
      }),
    );
    expect(mockCheckpoint.waitForRetryTimer).toHaveBeenCalledWith(stepId);
    expect(stepFn).toHaveBeenCalled();
  });

  it("should execute step function after retry timer completes", async () => {
    const stepId = "step-1";
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
      return null; // After retry timer, no cached data - will execute
    });

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = vi.fn().mockResolvedValue("executed-result");

    const result = await stepHandler("test-step", stepFn);

    expect(result).toBe("executed-result");
    expect(stepFn).toHaveBeenCalled();
    expect(mockCheckpoint.waitForRetryTimer).toHaveBeenCalledWith(stepId);
  });

  it("should execute step function after waiting for retry", async () => {
    const stepId = "step-1";
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
      return null; // After retry, no cached data
    });

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = vi.fn().mockResolvedValue("executed-after-retry");

    const result = await stepHandler("test-step", stepFn);

    expect(result).toBe("executed-after-retry");
    expect(stepFn).toHaveBeenCalled();
    expect(mockCheckpoint.waitForRetryTimer).toHaveBeenCalled();
  });
});
