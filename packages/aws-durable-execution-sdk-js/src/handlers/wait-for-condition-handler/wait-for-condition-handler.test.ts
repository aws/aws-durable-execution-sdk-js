import { createWaitForConditionHandler } from "./wait-for-condition-handler";
import {
  ExecutionContext,
  WaitForConditionCheckFunc,
  WaitForConditionConfig,
  OperationSubType,
  DurableLogger,
  OperationLifecycleState,
} from "../../types";
import { OperationType, OperationStatus } from "@aws-sdk/client-lambda";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";

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

describe("WaitForCondition Handler", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: jest.Mock;

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

    mockSafeSerialize.mockImplementation(async (_serdes, value) =>
      JSON.stringify(value),
    );
    mockSafeDeserialize.mockImplementation(async (_serdes, value) =>
      value ? JSON.parse(value) : undefined,
    );

    // Set up mockRunWithContext to execute the provided function
    mockRunWithContext.mockImplementation(async (_stepId, _parentId, fn) => {
      return await fn();
    });
  });

  describe("Parameter parsing", () => {
    it("should parse parameters with name", async () => {
      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        "parent-123",
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await handler("test-name", checkFunc, config);

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith("step-1", {
        Id: "step-1",
        ParentId: "parent-123",
        Action: "SUCCEED",
        SubType: OperationSubType.WAIT_FOR_CONDITION,
        Type: OperationType.STEP,
        Payload: '"ready"',
        Name: "test-name",
      });
    });

    it("should parse parameters without name", async () => {
      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await handler(checkFunc, config);

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith("step-1", {
        Id: "step-1",
        ParentId: undefined,
        Action: "SUCCEED",
        SubType: OperationSubType.WAIT_FOR_CONDITION,
        Type: OperationType.STEP,
        Payload: '"ready"',
        Name: undefined,
      });
    });

    it("should throw error if config is missing", async () => {
      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> =
        jest.fn();

      // The error is thrown synchronously during handler call, not when awaiting
      try {
        handler(checkFunc, undefined as any);
        fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).toContain(
          "waitForCondition requires config with waitStrategy and initialState",
        );
      }
    });
  });

  describe("Already completed operations", () => {
    it("should return cached result for succeeded operation", async () => {
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

      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("new-result");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      const result = await handler(checkFunc, config);

      expect(result).toBe("cached-result");
      expect(checkFunc).not.toHaveBeenCalled();
      expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();
      expect(mockCheckpoint.markOperationState).toHaveBeenCalledWith(
        stepId,
        OperationLifecycleState.COMPLETED,
        expect.any(Object),
      );
    });

    it("should throw error for failed operation", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      (mockContext as any)._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.FAILED,
        StepDetails: {
          Error: {
            ErrorMessage: "Check failed",
            ErrorType: "Error",
          },
        },
      };

      (mockContext.getStepData as jest.Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> =
        jest.fn();
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await expect(handler(checkFunc, config)).rejects.toThrow("Check failed");
    });
  });

  describe("Check function execution", () => {
    it("should execute check function and return result", async () => {
      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
      );

      const checkFunc: WaitForConditionCheckFunc<number, DurableLogger> = jest
        .fn()
        .mockResolvedValue(42);
      const config: WaitForConditionConfig<number> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: 0,
      };

      const result = await handler(checkFunc, config);

      expect(result).toBe(42);
      expect(checkFunc).toHaveBeenCalled();
      expect(mockCheckpoint.checkpoint).toHaveBeenCalledTimes(2); // START + SUCCEED
    });

    it("should loop until waitStrategy returns shouldContinue: false", async () => {
      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
      );

      let callCount = 0;
      const checkFunc: WaitForConditionCheckFunc<number, DurableLogger> = jest
        .fn()
        .mockImplementation(async () => {
          callCount++;
          return callCount;
        });

      const waitStrategy = jest
        .fn()
        .mockReturnValueOnce({
          shouldContinue: true,
          delay: { milliseconds: 1 },
        })
        .mockReturnValueOnce({
          shouldContinue: true,
          delay: { milliseconds: 1 },
        })
        .mockReturnValue({ shouldContinue: false });

      const config: WaitForConditionConfig<number> = {
        waitStrategy,
        initialState: 0,
      };

      const result = await handler(checkFunc, config);

      expect(result).toBe(3);
      expect(checkFunc).toHaveBeenCalledTimes(3);
      expect(waitStrategy).toHaveBeenCalledTimes(3);
    });

    it("should track running operations", async () => {
      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("done");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "start",
      };

      await handler(checkFunc, config);
    });
  });

  describe("currentAttempt parameter", () => {
    it("should pass currentAttempt 1 to both runWithContext and waitStrategy on first execution", async () => {
      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        "parent-123",
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("result");
      const waitStrategy = jest.fn().mockReturnValue({ shouldContinue: false });
      const config: WaitForConditionConfig<string> = {
        waitStrategy,
        initialState: "initial",
      };

      await handler(checkFunc, config);

      // Verify currentAttempt is passed correctly to both functions
      expect(mockRunWithContext).toHaveBeenCalledWith(
        "step-1",
        "parent-123",
        expect.any(Function),
        1, // currentAttempt should be 1 on first execution
        expect.any(String), // DurableExecutionMode.ExecutionMode
      );
      expect(waitStrategy).toHaveBeenCalledWith("result", 1);
    });

    it("should calculate currentAttempt correctly based on step data attempt count", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);

      // Mock step data with attempt = 2 (so currentAttempt should be 3)
      (mockContext as any)._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.READY,
        StepDetails: {
          Attempt: 2,
          Result: JSON.stringify("previous-state"),
        },
      };

      (mockContext.getStepData as jest.Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        "parent-123",
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("result");
      const waitStrategy = jest.fn().mockReturnValue({ shouldContinue: false });
      const config: WaitForConditionConfig<string> = {
        waitStrategy,
        initialState: "initial",
      };

      await handler(checkFunc, config);

      // Verify currentAttempt = Attempt + 1 for both functions
      expect(mockRunWithContext).toHaveBeenCalledWith(
        "step-1",
        "parent-123",
        expect.any(Function),
        3, // currentAttempt should be Attempt + 1 = 2 + 1 = 3
        expect.any(String),
      );
      expect(waitStrategy).toHaveBeenCalledWith("result", 3);
    });

    it("should pass incrementing currentAttempt through multiple retries", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);

      // Track the retry cycle - first call has no step data, then subsequent calls have increasing attempt numbers
      let getStepDataCallCount = 0;
      (mockContext.getStepData as jest.Mock).mockImplementation(() => {
        getStepDataCallCount++;

        // First call - no step data (fresh execution)
        if (getStepDataCallCount <= 2) {
          return null;
        }
        // Subsequent calls during retry cycles - simulate step data with increasing attempt number
        const attemptNumber = Math.floor((getStepDataCallCount - 2) / 2);
        return {
          Id: hashedStepId,
          Status: OperationStatus.READY,
          StepDetails: {
            Attempt: attemptNumber,
            Result: JSON.stringify(10),
          },
        };
      });

      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
      );

      const checkFunc: WaitForConditionCheckFunc<number, DurableLogger> = jest
        .fn()
        .mockResolvedValue(10);

      const waitStrategy = jest
        .fn()
        .mockReturnValueOnce({
          shouldContinue: true,
          delay: { milliseconds: 1 },
        })
        .mockReturnValueOnce({
          shouldContinue: true,
          delay: { milliseconds: 1 },
        })
        .mockReturnValue({ shouldContinue: false });

      const config: WaitForConditionConfig<number> = {
        waitStrategy,
        initialState: 0,
      };

      await handler(checkFunc, config);

      // Check that waitStrategy was called with incrementing currentAttempt values
      expect(waitStrategy).toHaveBeenNthCalledWith(1, 10, 1); // first attempt
      expect(waitStrategy).toHaveBeenNthCalledWith(2, 10, 2); // second attempt
      expect(waitStrategy).toHaveBeenNthCalledWith(3, 10, 3); // third attempt

      // Verify runWithContext was also called with correct attempts
      expect(mockRunWithContext).toHaveBeenCalledTimes(3);
      expect(mockRunWithContext).toHaveBeenNthCalledWith(
        1,
        "step-1",
        undefined,
        expect.any(Function),
        1,
        expect.any(String),
      );
      expect(mockRunWithContext).toHaveBeenNthCalledWith(
        2,
        "step-1",
        undefined,
        expect.any(Function),
        2,
        expect.any(String),
      );
      expect(mockRunWithContext).toHaveBeenNthCalledWith(
        3,
        "step-1",
        undefined,
        expect.any(Function),
        3,
        expect.any(String),
      );
    });
  });
});
