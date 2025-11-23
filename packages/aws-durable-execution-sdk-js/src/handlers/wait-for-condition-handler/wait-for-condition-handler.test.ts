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
  DurablePromise,
  DurableLogger,
} from "../../types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { OperationType, OperationStatus } from "@aws-sdk/client-lambda";
import { hashId, getStepData } from "../../utils/step-id-utils/step-id-utils";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";
import { EventEmitter } from "events";
import {
  WaitForConditionError,
  DurableOperationError,
  StepError,
} from "../../errors/durable-error/durable-error";
import { runWithContext } from "../../utils/context-tracker/context-tracker";
import { DurableExecutionMode } from "../../types/core";

jest.mock("../../utils/context-tracker/context-tracker", () => ({
  ...jest.requireActual("../../utils/context-tracker/context-tracker"),
}));

describe("WaitForCondition Handler", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockCheckpoint: jest.MockedFunction<CheckpointFunction>;
  let _mockParentContext: any;
  let createStepId: jest.Mock;
  let waitForConditionHandler: ReturnType<typeof createWaitForConditionHandler>;
  let mockTerminationManager: jest.Mocked<TerminationManager>;

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
      durableExecutionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:test",
      parentId: "parent-123",
      getStepData: jest.fn((stepId: string) => {
        return getStepData(stepData, stepId);
      }),
    } as unknown as jest.Mocked<ExecutionContext>;

    mockCheckpoint = createMockCheckpoint();
    _mockParentContext = {};
    createStepId = jest.fn().mockReturnValue("step-1");

    const mockLogger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      configureDurableLoggingContext: jest.fn(),
    };

    waitForConditionHandler = createWaitForConditionHandler(
      mockExecutionContext,
      mockCheckpoint,
      createStepId,
      mockLogger,
      jest.fn(), // addRunningOperation
      jest.fn(), // removeRunningOperation
      jest.fn(() => false), // hasRunningOperations
      () => new EventEmitter(), // getOperationsEmitter
      "parent-123", // parentId
    );
  });

  describe("Parameter parsing", () => {
    it("should parse parameters with name", async () => {
      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

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
      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

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
      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> =
        jest.fn();

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

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> =
        jest.fn();
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

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> =
        jest.fn();
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

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> =
        jest.fn();
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await expect(waitForConditionHandler(checkFunc, config)).rejects.toThrow(
        WaitForConditionError,
      );
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

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> =
        jest.fn();
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await expect(waitForConditionHandler(checkFunc, config)).rejects.toThrow(
        WaitForConditionError,
      );
      await expect(waitForConditionHandler(checkFunc, config)).rejects.toThrow(
        "waitForCondition failed",
      );
    });

    it("should reconstruct error from ErrorObject for failed operation", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      const originalError = new Error("Original error message");
      const errorObject = createErrorObjectFromError(originalError);

      mockExecutionContext._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.FAILED,
        StepDetails: {
          Error: errorObject,
        },
      } as any;

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> =
        jest.fn();
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await expect(waitForConditionHandler(checkFunc, config)).rejects.toThrow(
        "Original error message",
      );

      try {
        await waitForConditionHandler(checkFunc, config);
      } catch (error) {
        expect(error).toBeInstanceOf(DurableOperationError);
      }
    });
  });

  describe("First execution", () => {
    it("should complete successfully when condition is met on first attempt", async () => {
      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
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

      const result = await waitForConditionHandler(checkFunc, config);

      expect(result).toBe("ready");
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
      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("not-ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: (state, attempt) => {
          expect(state).toBe("not-ready");
          expect(attempt).toBe(1);
          return { shouldContinue: true, delay: { seconds: 30 } };
        },
        initialState: "initial",
      };

      const _promise = waitForConditionHandler(checkFunc, config);

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
        message: "Retry scheduled for step-1",
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

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
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

      const result = await waitForConditionHandler(checkFunc, config);

      expect(result).toBe("ready");
    });

    it("should restore state from valid checkpoint data when status is READY", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.READY,
        StepDetails: {
          Result: '"previous-state"', // Just the serialized state, not wrapped
          Attempt: 2, // System-provided attempt number
        },
      } as any;

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
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

      const result = await waitForConditionHandler(checkFunc, config);

      expect(result).toBe("ready");
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

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
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

      const result = await waitForConditionHandler(checkFunc, config);

      expect(result).toBe("ready");
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

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
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

      const result = await waitForConditionHandler(checkFunc, config);

      expect(result).toBe("ready");
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

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
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

      const result = await waitForConditionHandler(checkFunc, config);

      expect(result).toBe("ready");
    });

    it("should return never-resolving promise when scheduling retry", async () => {
      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("not-ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: true, delay: { seconds: 30 } }),
        initialState: "initial",
      };

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
        message: "Retry scheduled for step-1",
      });

      // Verify that the promise is indeed a DurablePromise
      expect(promise).toBeInstanceOf(DurablePromise);
    });

    it("should wait for timer when status is PENDING", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.PENDING,
      } as any;

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      const promise = waitForConditionHandler(checkFunc, config);

      // Should terminate with retry scheduled message
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.RETRY_SCHEDULED,
        message: "Retry scheduled for step-1",
      });

      // Should return never-resolving promise
      let resolved = false;
      promise.then(() => {
        resolved = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(resolved).toBe(false);
    });
  });

  describe("Error handling", () => {
    it("should fail when check function throws an error", async () => {
      const error = new Error("Check function failed");
      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockRejectedValue(error);
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await expect(waitForConditionHandler(checkFunc, config)).rejects.toThrow(
        StepError, // After reconstruction, generic errors become StepError
      );
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
      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockRejectedValue(nonErrorException);
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      // The original exception is wrapped in StepError after reconstruction
      await expect(waitForConditionHandler(checkFunc, config)).rejects.toThrow(
        StepError, // After reconstruction, generic errors become StepError
      );
      await expect(waitForConditionHandler(checkFunc, config)).rejects.toThrow(
        "Unknown error", // Default message for non-Error exceptions
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

  // Test cases for runWithContext logic - verifying attempt + 1 and ExecutionMode passing
  describe("runWithContext Integration", () => {
    beforeEach(() => {
      // Setup runWithContext mock to return the check function result for these specific tests
      (runWithContext as jest.Mock) = jest
        .fn()
        .mockImplementation(async (stepId, parentId, fn, _attempt, _mode) => {
          try {
            return await fn();
          } catch (error) {
            // Re-throw errors so they can be handled by the handler logic
            throw error;
          }
        });
    });

    it("should call runWithContext with correct parameters for new waitForCondition (attempt 1 -> 2)", async () => {
      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await waitForConditionHandler(checkFunc, config);

      // Verify runWithContext was called with correct parameters
      expect(runWithContext).toHaveBeenCalledWith(
        "step-1",
        "parent-123", // parentId from handler setup
        expect.any(Function), // The wrapped check function
        2, // currentAttempt (1) + 1 = 2
        DurableExecutionMode.ExecutionMode,
      );
    });

    it("should call runWithContext with correct attempt number for retry waitForCondition (attempt 3 -> 4)", async () => {
      // Set up a waitForCondition that was previously attempted 3 times (so attempt = 3)
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.STARTED,
        StepDetails: {
          Result: '"previous-state"',
          Attempt: 3, // Previous attempt was 3
        },
      } as any;

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await waitForConditionHandler(checkFunc, config);

      // Verify runWithContext was called with attempt 4 (3 + 1)
      expect(runWithContext).toHaveBeenCalledWith(
        "step-1",
        "parent-123",
        expect.any(Function),
        4, // currentAttempt (3) + 1 = 4
        DurableExecutionMode.ExecutionMode,
      );
    });

    it("should call runWithContext with correct stepId and parentId when parentId is provided", async () => {
      // This test verifies the parentId is passed through correctly (already set in beforeEach)
      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await waitForConditionHandler(checkFunc, config);

      // Verify runWithContext was called with correct stepId and parentId
      expect(runWithContext).toHaveBeenCalledWith(
        "step-1",
        "parent-123", // parentId should be passed through
        expect.any(Function),
        2, // currentAttempt (1) + 1 = 2
        DurableExecutionMode.ExecutionMode,
      );
    });

    it("should pass the check function through runWithContext correctly", async () => {
      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = jest
        .fn()
        .mockResolvedValue("ready");
      let capturedFunction: (() => Promise<unknown>) | undefined;

      // Capture the function passed to runWithContext
      (runWithContext as jest.Mock).mockImplementation(
        async (stepId, parentId, fn, _attempt, _mode) => {
          capturedFunction = fn;
          return await fn();
        },
      );

      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await waitForConditionHandler(checkFunc, config);

      // Verify that the captured function calls our check function with WaitForConditionContext
      expect(capturedFunction).toBeDefined();

      // The captured function should be the wrapped version that calls checkFunc with WaitForConditionContext
      expect(checkFunc).toHaveBeenCalledWith(
        "initial", // currentState
        expect.objectContaining({
          logger: expect.anything(),
        }),
      );
    });

    it("should not call runWithContext for completed waitForConditions (cached results)", async () => {
      // Set up a completed waitForCondition
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.SUCCEEDED,
        StepDetails: {
          Result: '"cached-result"',
        },
      } as any;

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> =
        jest.fn();
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      const result = await waitForConditionHandler(checkFunc, config);

      // Should return cached result
      expect(result).toBe("cached-result");
      // Should not call runWithContext since operation is already completed
      expect(runWithContext).not.toHaveBeenCalled();
      // Should not call the check function
      expect(checkFunc).not.toHaveBeenCalled();
    });

    it("should not call runWithContext for failed waitForConditions", async () => {
      // Set up a failed waitForCondition
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.FAILED,
        StepDetails: {
          Result: "Operation failed",
        },
      } as any;

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> =
        jest.fn();
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      // Should throw the cached error
      await expect(waitForConditionHandler(checkFunc, config)).rejects.toThrow(
        "Operation failed",
      );

      // Should not call runWithContext since operation already failed
      expect(runWithContext).not.toHaveBeenCalled();
      // Should not call the check function
      expect(checkFunc).not.toHaveBeenCalled();
    });
  });
});

describe("wait-for-condition-handler termination method", () => {
  it("should use custom termination method when attached", async () => {
    const customTerminate = jest.fn().mockReturnValue(new Promise(() => {}));

    const mockContext = {
      getStepData: jest
        .fn()
        .mockReturnValue({ Status: OperationStatus.PENDING }),
      terminationManager: { terminate: jest.fn() },
      durableExecutionArn: "arn:test",
    } as unknown as ExecutionContext;

    const handler = createWaitForConditionHandler(
      mockContext,
      jest.fn() as any,
      jest.fn().mockReturnValue("step-1"),
      jest.fn(),
      jest.fn(),
      jest.fn(),
      jest.fn().mockReturnValue(false),
      jest.fn().mockReturnValue(new EventEmitter()),
      undefined,
    );

    const promise = handler(async () => ({ shouldContinue: false }), {
      initialState: { shouldContinue: false },
      waitStrategy: () => ({ shouldContinue: false }),
    });
    promise.attachTerminationMethod(customTerminate);

    // Verify the custom termination method is attached
    expect(promise.getTerminationMethod()).toBe(customTerminate);
  });

  it("should use default termination method when not attached", async () => {
    const mockContext = {
      getStepData: jest
        .fn()
        .mockReturnValue({ Status: OperationStatus.PENDING }),
      terminationManager: { terminate: jest.fn() },
      durableExecutionArn: "arn:test",
    } as unknown as ExecutionContext;

    const handler = createWaitForConditionHandler(
      mockContext,
      jest.fn() as any,
      jest.fn().mockReturnValue("step-1"),
      jest.fn(),
      jest.fn(),
      jest.fn(),
      jest.fn().mockReturnValue(false),
      jest.fn().mockReturnValue(new EventEmitter()),
      undefined,
    );

    const promise = handler(async () => ({ shouldContinue: false }), {
      initialState: { shouldContinue: false },
      waitStrategy: () => ({ shouldContinue: false }),
    });

    // Verify the default termination method is set
    expect(promise.getTerminationMethod()).toBeDefined();
    expect(typeof promise.getTerminationMethod()).toBe("function");
  });
});
