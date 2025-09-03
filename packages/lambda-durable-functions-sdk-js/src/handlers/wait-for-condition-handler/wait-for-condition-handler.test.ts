import {
  createMockCheckpoint,
  CheckpointFunction,
} from "../../testing/mock-checkpoint";
import { createWaitForConditionHandler } from "./wait-for-condition-handler";
import {
  ExecutionContext,
  WaitForConditionCheckFunc,
  WaitForConditionConfig,
  OperationSubType,
} from "../../types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { OperationType, OperationStatus } from "@amzn/dex-internal-sdk";
import { OperationInterceptor } from "../../mocks/operation-interceptor";
import { hashId, getStepData } from "../../utils/step-id-utils/step-id-utils";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";

jest.mock("../../mocks/operation-interceptor");

describe("WaitForCondition Handler", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockCheckpoint: jest.MockedFunction<CheckpointFunction>;
  let mockParentContext: any;
  let createStepId: jest.Mock;
  let waitForConditionHandler: ReturnType<typeof createWaitForConditionHandler>;
  let mockTerminationManager: jest.Mocked<TerminationManager>;
  let mockExecutionRunner: any;

  beforeEach(() => {
    jest.resetAllMocks();

    mockTerminationManager = {
      terminate: jest.fn(),
      getTerminationPromise: jest.fn(),
    } as unknown as jest.Mocked<TerminationManager>;

    const stepData = {};
    mockExecutionContext = {
      state: {
        getStepData: jest.fn(),
        checkpoint: jest.fn(),
      },
      _stepData: stepData,
      terminationManager: mockTerminationManager,
      isLocalMode: false,
      isVerbose: false,
      durableExecutionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:test",
      parentId: "parent-123",
      executionContextId: "exec-123",
      customerHandlerEvent: {},
      getStepData: jest.fn((stepId: string) => {
        return getStepData(stepData, stepId);
      }),
    } as unknown as jest.Mocked<ExecutionContext>;

    mockCheckpoint = createMockCheckpoint();
    mockParentContext = {};
    createStepId = jest.fn().mockReturnValue("step-1");

    mockExecutionRunner = {
      execute: jest.fn(),
    };

    (OperationInterceptor.forExecution as jest.Mock).mockReturnValue(
      mockExecutionRunner,
    );

    waitForConditionHandler = createWaitForConditionHandler(
      mockExecutionContext,
      mockCheckpoint,
      createStepId,
    );
  });

  describe("Parameter parsing", () => {
    it("should parse parameters with name", async () => {
      const checkFunc: WaitForConditionCheckFunc<string> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      mockExecutionRunner.execute.mockResolvedValue("ready");

      await waitForConditionHandler("test-name", checkFunc, config);

      expect(mockCheckpoint).toHaveBeenCalledWith("step-1", {
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
      const checkFunc: WaitForConditionCheckFunc<string> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      mockExecutionRunner.execute.mockResolvedValue("ready");

      await waitForConditionHandler(checkFunc, config);

      expect(mockCheckpoint).toHaveBeenCalledWith("step-1", {
        Id: "step-1",
        ParentId: "parent-123",
        Action: "SUCCEED",
        SubType: OperationSubType.WAIT_FOR_CONDITION,
        Type: OperationType.STEP,
        Payload: '"ready"',
        Name: undefined,
      });
    });

    it("should throw error if config is missing", async () => {
      const checkFunc: WaitForConditionCheckFunc<string> = jest.fn();

      await expect(
        waitForConditionHandler(checkFunc, undefined as any),
      ).rejects.toThrow(
        "waitForCondition requires config with waitStrategy and initialState",
      );
    });
  });

  describe("Already completed operations", () => {
    it("should return cached result for succeeded operation", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.SUCCEEDED,
        StepDetails: {
          Result: '"completed-result"',
        },
      } as any;

      const checkFunc: WaitForConditionCheckFunc<string> = jest.fn();
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      const result = await waitForConditionHandler(checkFunc, config);

      expect(result).toBe("completed-result");
      expect(checkFunc).not.toHaveBeenCalled();
      expect(mockCheckpoint).not.toHaveBeenCalled();
    });

    it("should handle completed operation with undefined result", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.SUCCEEDED,
        StepDetails: {
          // No Result field - should be handled by safeDeserialize
        },
      } as any;

      const checkFunc: WaitForConditionCheckFunc<string> = jest.fn();
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      const result = await waitForConditionHandler(checkFunc, config);

      // safeDeserialize should handle undefined and return undefined
      expect(result).toBeUndefined();
      expect(checkFunc).not.toHaveBeenCalled();
      expect(mockCheckpoint).not.toHaveBeenCalled();
    });

    it("should throw error for failed operation", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.FAILED,
        StepDetails: {
          Result: "Operation failed",
        },
      } as any;

      const checkFunc: WaitForConditionCheckFunc<string> = jest.fn();
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await expect(waitForConditionHandler(checkFunc, config)).rejects.toThrow(
        "Operation failed",
      );
    });

    it("should throw default error message for failed operation with no error message", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.FAILED,
        StepDetails: {
          Result: "", // Empty error message
        },
      } as any;

      const checkFunc: WaitForConditionCheckFunc<string> = jest.fn();
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await expect(waitForConditionHandler(checkFunc, config)).rejects.toThrow(
        "waitForCondition failed",
      );
    });
  });

  describe("First execution", () => {
    it("should complete successfully when condition is met on first attempt", async () => {
      const checkFunc: WaitForConditionCheckFunc<string> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: (state, attempt) => {
          expect(state).toBe("ready");
          expect(attempt).toBe(1);
          return { shouldContinue: false };
        },
        initialState: "initial",
      };

      mockExecutionRunner.execute.mockResolvedValue("ready");

      const result = await waitForConditionHandler(checkFunc, config);

      expect(result).toBe("ready");
      expect(mockExecutionRunner.execute).toHaveBeenCalledWith(
        undefined,
        expect.any(Function),
      );
      expect(mockCheckpoint).toHaveBeenCalledWith("step-1", {
        Id: "step-1",
        ParentId: "parent-123",
        Action: "SUCCEED",
        SubType: OperationSubType.WAIT_FOR_CONDITION,
        Type: OperationType.STEP,
        Payload: '"ready"',
        Name: undefined,
      });
    });

    it("should schedule retry when condition is not met", async () => {
      const checkFunc: WaitForConditionCheckFunc<string> = jest
        .fn()
        .mockResolvedValue("not-ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: (state, attempt) => {
          expect(state).toBe("not-ready");
          expect(attempt).toBe(1);
          return { shouldContinue: true, delaySeconds: 30 };
        },
        initialState: "initial",
      };

      mockExecutionRunner.execute.mockResolvedValue("not-ready");

      const promise = waitForConditionHandler(checkFunc, config);

      // Should not resolve
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockCheckpoint).toHaveBeenCalledWith("step-1", {
        Id: "step-1",
        ParentId: "parent-123",
        Action: "RETRY",
        SubType: OperationSubType.WAIT_FOR_CONDITION,
        Type: OperationType.STEP,
        Payload: '"not-ready"', // Just the serialized state, not wrapped
        Name: undefined,
        StepOptions: {
          NextAttemptDelaySeconds: 30,
        },
      });

      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.RETRY_SCHEDULED,
        message: "waitForCondition step-1 will retry in 30 seconds",
      });
    });
  });

  describe("Retry scenarios", () => {
    it("should restore state from valid checkpoint data on retry", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.STARTED,
        StepDetails: {
          Result: '"previous-state"', // Just the serialized state, not wrapped
          Attempt: 2, // System-provided attempt number
        },
      } as any;

      const checkFunc: WaitForConditionCheckFunc<string> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: (state, attempt) => {
          expect(state).toBe("ready");
          expect(attempt).toBe(2); // Should use attempt from system
          return { shouldContinue: false };
        },
        initialState: "initial",
      };

      // Mock the execution to call the check function with the restored state
      mockExecutionRunner.execute.mockImplementation(
        async (name: any, fn: any) => {
          const result = await fn();
          return result;
        },
      );

      const result = await waitForConditionHandler(checkFunc, config);

      expect(result).toBe("ready");
      // Verify the execution runner was called
      expect(mockExecutionRunner.execute).toHaveBeenCalled();
    });

    it("should use initial state when checkpoint data is invalid JSON", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.STARTED,
        StepDetails: {
          Result: "invalid-json{", // Invalid JSON
          Attempt: 2, // System still provides attempt number
        },
      } as any;

      const checkFunc: WaitForConditionCheckFunc<string> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: (state, attempt) => {
          expect(state).toBe("ready");
          expect(attempt).toBe(2); // Should still use system attempt number
          return { shouldContinue: false };
        },
        initialState: "initial",
      };

      mockExecutionRunner.execute.mockImplementation(
        async (name: any, fn: any) => {
          const result = await fn();
          return result;
        },
      );

      const result = await waitForConditionHandler(checkFunc, config);

      expect(result).toBe("ready");
      expect(mockExecutionRunner.execute).toHaveBeenCalled();
    });

    it("should use initial state when checkpoint data is missing", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.STARTED,
        StepDetails: {
          // No Result field
          Attempt: 3, // System still provides attempt number
        },
      } as any;

      const checkFunc: WaitForConditionCheckFunc<string> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: (state, attempt) => {
          expect(state).toBe("ready");
          expect(attempt).toBe(3); // Should use system attempt number
          return { shouldContinue: false };
        },
        initialState: "initial",
      };

      mockExecutionRunner.execute.mockImplementation(
        async (name: any, fn: any) => {
          const result = await fn();
          return result;
        },
      );

      const result = await waitForConditionHandler(checkFunc, config);

      expect(result).toBe("ready");
      expect(mockExecutionRunner.execute).toHaveBeenCalled();
    });

    it("should default to attempt 1 when system attempt is missing", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.STARTED,
        StepDetails: {
          Result: '"previous-state"',
          // No Attempt field - should default to 1
        },
      } as any;

      const checkFunc: WaitForConditionCheckFunc<string> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: (state, attempt) => {
          expect(state).toBe("ready");
          expect(attempt).toBe(1); // Should default to 1 when system attempt is missing
          return { shouldContinue: false };
        },
        initialState: "initial",
      };

      mockExecutionRunner.execute.mockImplementation(
        async (name: any, fn: any) => {
          const result = await fn();
          return result;
        },
      );

      const result = await waitForConditionHandler(checkFunc, config);

      expect(result).toBe("ready");
      expect(mockExecutionRunner.execute).toHaveBeenCalled();
    });

    it("should return never-resolving promise when scheduling retry", async () => {
      const checkFunc: WaitForConditionCheckFunc<string> = jest
        .fn()
        .mockResolvedValue("not-ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: true, delaySeconds: 30 }),
        initialState: "initial",
      };

      mockExecutionRunner.execute.mockResolvedValue("not-ready");

      const promise = waitForConditionHandler(checkFunc, config);

      // Verify the promise doesn't resolve quickly
      let resolved = false;
      promise
        .then(() => {
          resolved = true;
        })
        .catch(() => {
          resolved = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(resolved).toBe(false);

      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.RETRY_SCHEDULED,
        message: "waitForCondition step-1 will retry in 30 seconds",
      });

      // Verify that the promise is indeed never-resolving by checking its constructor
      expect(promise).toBeInstanceOf(Promise);
    });
  });

  describe("Error handling", () => {
    it("should fail when check function throws an error", async () => {
      const error = new Error("Check function failed");
      const checkFunc: WaitForConditionCheckFunc<string> = jest
        .fn()
        .mockRejectedValue(error);
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      mockExecutionRunner.execute.mockRejectedValue(error);

      await expect(waitForConditionHandler(checkFunc, config)).rejects.toThrow(
        "Check function failed",
      );

      expect(mockCheckpoint).toHaveBeenCalledWith("step-1", {
        Id: "step-1",
        ParentId: "parent-123",
        Action: "FAIL",
        SubType: OperationSubType.WAIT_FOR_CONDITION,
        Type: OperationType.STEP,
        Error: createErrorObjectFromError(error),
        Name: undefined,
      });
    });

    it("should handle non-Error exceptions with default message", async () => {
      const nonErrorException = "String error"; // Not an Error instance
      const checkFunc: WaitForConditionCheckFunc<string> = jest
        .fn()
        .mockRejectedValue(nonErrorException);
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      mockExecutionRunner.execute.mockRejectedValue(nonErrorException);

      // The original exception is re-thrown, but the checkpoint gets "Unknown error"
      await expect(waitForConditionHandler(checkFunc, config)).rejects.toBe(
        "String error",
      );

      expect(mockCheckpoint).toHaveBeenCalledWith("step-1", {
        Id: "step-1",
        ParentId: "parent-123",
        Action: "FAIL",
        SubType: OperationSubType.WAIT_FOR_CONDITION,
        Type: OperationType.STEP,
        Error: createErrorObjectFromError("Unknown error"), // Should use default message for non-Error
        Name: undefined,
      });
    });
  });
});
