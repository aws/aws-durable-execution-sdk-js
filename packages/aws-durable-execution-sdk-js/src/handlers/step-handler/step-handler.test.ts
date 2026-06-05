import { createStepHandler } from "./step-handler";
import {
  ExecutionContext,
  StepSemantics,
  OperationLifecycleState,
  OperationSubType,
} from "../../types";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { Context } from "aws-lambda";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
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

describe("Step Handler", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let mockParentContext: Context;
  let createStepId: () => string;
  let stepIdCounter = 0;

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

    mockSafeSerialize.mockImplementation(async (_serdes, value) =>
      JSON.stringify(value),
    );
    mockSafeDeserialize.mockImplementation(async (_serdes, value) =>
      value ? JSON.parse(value) : undefined,
    );
  });

  it("should execute step function with StepContext", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = jest.fn().mockResolvedValue("step-result");

    const result = await stepHandler("test-step", stepFn);

    expect(result).toBe("step-result");
    expect(stepFn).toHaveBeenCalledTimes(1);
    expect(stepFn.mock.calls[0][0]).toHaveProperty("logger");
  });

  it("should checkpoint at start and finish with AT_LEAST_ONCE_PER_RETRY semantics", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = jest.fn().mockResolvedValue("step-result");

    await stepHandler("test-step", stepFn);

    expect(mockCheckpoint.checkpoint).toHaveBeenCalledTimes(2);
    expect(mockCheckpoint.checkpoint).toHaveBeenNthCalledWith(
      1,
      "step-1",
      expect.objectContaining({
        Action: "START",
        Type: "STEP",
      }),
    );
    expect(mockCheckpoint.checkpoint).toHaveBeenNthCalledWith(
      2,
      "step-1",
      expect.objectContaining({
        Action: "SUCCEED",
        Payload: JSON.stringify("step-result"),
      }),
    );
  });

  it("should checkpoint at start and finish with AT_MOST_ONCE_PER_RETRY semantics", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = jest.fn().mockResolvedValue("step-result");

    await stepHandler("test-step", stepFn, {
      semantics: StepSemantics.AtMostOncePerRetry,
    });

    expect(mockCheckpoint.checkpoint).toHaveBeenCalledTimes(2);
  });

  it("should return cached result for completed step", async () => {
    const stepId = "step-1";
    const hashedStepId = hashId(stepId);
    (mockContext as any)._stepData[hashedStepId] = {
      Id: hashedStepId,
      Status: OperationStatus.SUCCEEDED,
      StepDetails: {
        Result: JSON.stringify("cached-result"),
      },
    };

    (mockContext.getStepData as jest.Mock).mockReturnValue(
      (mockContext as any)._stepData[hashedStepId],
    );

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = jest.fn().mockResolvedValue("new-result");

    const result = await stepHandler("test-step", stepFn);

    expect(result).toBe("cached-result");
    expect(stepFn).not.toHaveBeenCalled();
    expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();
    expect(mockCheckpoint.markOperationState).toHaveBeenCalledWith(
      stepId,
      OperationLifecycleState.COMPLETED,
      {
        metadata: {
          stepId,
          type: OperationType.STEP,
          subType: OperationSubType.STEP,
          name: "test-step",
          parentId: undefined,
        },
      },
    );
  });

  it("should handle failed step", async () => {
    const stepId = "step-1";
    const hashedStepId = hashId(stepId);
    (mockContext as any)._stepData[hashedStepId] = {
      Id: hashedStepId,
      Status: OperationStatus.FAILED,
      StepDetails: {
        Error: {
          ErrorMessage: "Step failed",
          ErrorType: "Error",
        },
      },
    };

    (mockContext.getStepData as jest.Mock).mockReturnValue(
      (mockContext as any)._stepData[hashedStepId],
    );

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = jest.fn().mockResolvedValue("result");

    await expect(stepHandler("test-step", stepFn)).rejects.toThrow(
      "Step failed",
    );
    expect(stepFn).not.toHaveBeenCalled();
  });

  it("should handle pending retry", async () => {
    const stepId = "step-1";
    const hashedStepId = hashId(stepId);
    const nextAttemptTime = new Date(Date.now() + 10000);

    let callCount = 0;
    (mockContext.getStepData as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          Id: hashedStepId,
          Status: OperationStatus.PENDING,
          StepDetails: {
            NextAttemptTimestamp: nextAttemptTime,
          },
        };
      } else {
        return {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          StepDetails: {
            Result: JSON.stringify("retry-result"),
          },
        };
      }
    });

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = jest.fn().mockResolvedValue("retry-result");

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
  });

  it("should track running operations", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = jest.fn().mockResolvedValue("result");

    await stepHandler("test-step", stepFn);
  });

  it("should handle step without name", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = jest.fn().mockResolvedValue("result");

    const result = await stepHandler(stepFn);

    expect(result).toBe("result");
    expect(stepFn).toHaveBeenCalled();
  });

  // Regression for https://github.com/aws/aws-durable-execution-sdk-js/pull/569 (issue #529).
  // When a step with AT_MOST_ONCE_PER_RETRY semantics is interrupted (e.g. Lambda timeout
  // before the step completes) and the user's retryStrategy returns shouldRetry: false,
  // the next replay enters the "interrupted-step" branch. This branch must:
  //   1. Pass `metadata` to markOperationState so the checkpoint manager doesn't crash
  //      with "metadata required on first call for <stepId>".
  //   2. Throw a StepError to the user (DurableOperationError contract), not
  //      StepInterruptedError. StepInterruptedError is an internal sentinel used as the
  //      input to retryStrategy; the cause chain preserves it for inspection.
  describe("interrupted step with AT_MOST_ONCE_PER_RETRY", () => {
    const setupInterruptedStep = (stepId: string) => {
      const hashedStepId = hashId(stepId);
      (mockContext as any)._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.STARTED,
        StepDetails: { Attempt: 0 },
      };
      (mockContext.getStepData as jest.Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );
    };

    it("should pass metadata to markOperationState when retryStrategy returns shouldRetry: false (no crash on fresh replay)", async () => {
      setupInterruptedStep("step-1");

      const stepHandler = createStepHandler(
        mockContext,
        mockCheckpoint,
        mockParentContext,
        createStepId,
        createDefaultLogger(),
      );

      const stepFn = jest.fn().mockResolvedValue("never-runs");

      await expect(
        stepHandler("test-step", stepFn, {
          semantics: StepSemantics.AtMostOncePerRetry,
          retryStrategy: () => ({ shouldRetry: false }),
        }),
      ).rejects.toBeDefined();

      // The fix: COMPLETED must be marked WITH metadata, otherwise the checkpoint
      // manager throws "metadata required on first call" on a cold replay where
      // the operations map is empty.
      expect(mockCheckpoint.markOperationState).toHaveBeenCalledWith(
        "step-1",
        OperationLifecycleState.COMPLETED,
        {
          metadata: {
            stepId: "step-1",
            name: "test-step",
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
            parentId: undefined,
          },
        },
      );

      // Step body must NOT be re-executed under AT_MOST_ONCE_PER_RETRY.
      expect(stepFn).not.toHaveBeenCalled();

      // Failure must be checkpointed.
      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith(
        "step-1",
        expect.objectContaining({
          Action: "FAIL",
          Type: OperationType.STEP,
          SubType: OperationSubType.STEP,
        }),
      );
    });

    it("should throw a StepError (not StepInterruptedError) to the handler, preserving the cause", async () => {
      setupInterruptedStep("step-1");

      const stepHandler = createStepHandler(
        mockContext,
        mockCheckpoint,
        mockParentContext,
        createStepId,
        createDefaultLogger(),
      );

      const stepFn = jest.fn().mockResolvedValue("never-runs");

      let caught: unknown;
      try {
        await stepHandler("test-step", stepFn, {
          semantics: StepSemantics.AtMostOncePerRetry,
          retryStrategy: () => ({ shouldRetry: false }),
        });
      } catch (err) {
        caught = err;
      }

      // Public contract: handlers always receive a DurableOperationError subclass
      // (StepError for step failures). StepInterruptedError is an internal sentinel
      // passed only to retryStrategy.
      expect(caught).toBeDefined();
      const err = caught as Error & { cause?: Error; errorType?: string };
      expect(err.name).toBe("StepError");
      expect(err.errorType).toBe("StepError");
      // The cause chain preserves the original interruption signal so users can
      // detect it via err.cause?.name === "StepInterruptedError" if they need to.
      expect(err.cause?.name).toBe("StepInterruptedError");
    });

    it("should call retryStrategy with a StepInterruptedError instance", async () => {
      setupInterruptedStep("step-1");

      const stepHandler = createStepHandler(
        mockContext,
        mockCheckpoint,
        mockParentContext,
        createStepId,
        createDefaultLogger(),
      );

      const retryStrategy = jest.fn().mockReturnValue({ shouldRetry: false });

      await expect(
        stepHandler("test-step", jest.fn(), {
          semantics: StepSemantics.AtMostOncePerRetry,
          retryStrategy,
        }),
      ).rejects.toBeDefined();

      expect(retryStrategy).toHaveBeenCalledTimes(1);
      const [errorArg, attempt] = retryStrategy.mock.calls[0];
      expect(errorArg).toBeInstanceOf(Error);
      expect((errorArg as Error).name).toBe("StepInterruptedError");
      expect(typeof attempt).toBe("number");
    });
  });
});
