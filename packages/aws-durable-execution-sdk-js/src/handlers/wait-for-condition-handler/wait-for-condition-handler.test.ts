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
});
