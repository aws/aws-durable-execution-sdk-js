import {
  createMockCheckpoint,
  CheckpointFunction,
} from "../../testing/mock-checkpoint";
import { createStepHandler } from "./step-handler";
import { ExecutionContext, StepSemantics } from "../../types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

describe("Step Handler Timing Tests", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockCheckpoint: jest.MockedFunction<CheckpointFunction>;
  let mockParentContext: any;
  let createStepId: jest.Mock;
  let stepHandler: ReturnType<typeof createStepHandler>;
  let mockTerminationManager: jest.Mocked<TerminationManager>;

  beforeEach(() => {
    jest.resetAllMocks();

    mockTerminationManager = {
      terminate: jest.fn(),
      getTerminationPromise: jest.fn(),
    } as unknown as jest.Mocked<TerminationManager>;

    mockExecutionContext = {
      durableExecutionArn: "test-arn",
      parentId: "test-parent-id",
      terminationManager: mockTerminationManager,
      getStepData: jest.fn().mockReturnValue(undefined),
      _stepData: {},
    } as unknown as jest.Mocked<ExecutionContext>;

    mockCheckpoint = createMockCheckpoint();
    mockParentContext = { getRemainingTimeInMillis: () => 30000 };
    createStepId = jest.fn().mockReturnValue("test-step-id");

    stepHandler = createStepHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      jest.fn().mockReturnValue({ log: jest.fn() }),
      jest.fn(),
      jest.fn(),
      jest.fn().mockReturnValue(false),
    );
  });

  describe("Step Handler Timing and Concurrency Tests", () => {
    test("should terminate when retry is scheduled", async () => {
      const stepFn = jest.fn().mockRejectedValue(new Error("Test error"));
      const mockRetryStrategy = jest
        .fn()
        .mockReturnValue({ shouldRetry: true, delaySeconds: 1 });

      const mockHasRunningOperations = jest.fn().mockReturnValue(false);

      const stepHandlerWithMocks = createStepHandler(
        mockExecutionContext,
        mockCheckpoint,
        mockParentContext,
        createStepId,
        jest.fn().mockReturnValue({ log: jest.fn() }),
        jest.fn(),
        jest.fn(),
        mockHasRunningOperations,
      );

      const stepPromise = stepHandlerWithMocks("test-step", stepFn, {
        retryStrategy: mockRetryStrategy,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.RETRY_SCHEDULED,
        message: expect.stringContaining("test-step"),
      });
    });

    test("should wait for pending step and continue execution", async () => {
      const stepId = "test-step-id";
      const hashedStepId = hashId(stepId);

      // Create a step handler that will definitely hit the PENDING path
      const mockGetStepData = jest
        .fn()
        .mockReturnValueOnce({
          Id: hashedStepId,
          Status: OperationStatus.PENDING,
          StepDetails: { Attempt: 1 },
        })
        .mockReturnValueOnce(undefined); // After continue, return undefined to proceed

      mockExecutionContext.getStepData = mockGetStepData;

      const stepFn = jest.fn().mockResolvedValue("test-result");

      // Mock hasRunningOperations to return true initially (to trigger waitForContinuation)
      // then false to allow normal execution
      const mockHasRunningOperations = jest
        .fn()
        .mockReturnValueOnce(true)
        .mockReturnValue(false);

      const stepHandlerWithMocks = createStepHandler(
        mockExecutionContext,
        mockCheckpoint,
        mockParentContext,
        createStepId,
        jest.fn().mockReturnValue({ log: jest.fn() }),
        jest.fn(),
        jest.fn(),
        mockHasRunningOperations,
      );

      const result = await stepHandlerWithMocks("test-step", stepFn);

      // Verify the continue statement was executed by checking the result
      expect(result).toBe("test-result");
      expect(mockGetStepData).toHaveBeenCalled();
    });

    test("should retry interrupted AtMostOncePerRetry step and continue main loop", async () => {
      const stepId = "test-step-id";
      const hashedStepId = hashId(stepId);

      // Set up step data with STARTED status (interrupted) for AtMostOncePerRetry
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          StepDetails: { Attempt: 1 },
        },
      } as any;

      mockExecutionContext.getStepData = jest
        .fn()
        .mockReturnValueOnce({
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          StepDetails: { Attempt: 1 },
        })
        .mockReturnValue(undefined); // After continue, return undefined to proceed

      const stepFn = jest.fn().mockResolvedValue("retry-result");

      // Mock retry strategy that decides to retry the interrupted step
      const mockRetryStrategy = jest.fn().mockReturnValue({
        shouldRetry: true,
        delaySeconds: 2,
      });

      // Mock hasRunningOperations to trigger waitForContinuation, then allow execution
      const mockHasRunningOperations = jest
        .fn()
        .mockReturnValueOnce(true) // Trigger waitForContinuation in retry path (line 207)
        .mockReturnValue(false); // Allow execution after continue

      const stepHandlerWithMocks = createStepHandler(
        mockExecutionContext,
        mockCheckpoint,
        mockParentContext,
        createStepId,
        jest.fn().mockReturnValue({ log: jest.fn() }),
        jest.fn(),
        jest.fn(),
        mockHasRunningOperations,
      );

      const result = await stepHandlerWithMocks("test-step", stepFn, {
        semantics: StepSemantics.AtMostOncePerRetry, // This is key for line 207
        retryStrategy: mockRetryStrategy,
      });

      expect(result).toBe("retry-result");
      expect(mockRetryStrategy).toHaveBeenCalled();
      expect(mockHasRunningOperations).toHaveBeenCalled();
    });

    test("should retry step with scheduled delay", async () => {
      const stepId = "test-step-id";
      const hashedStepId = hashId(stepId);

      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          StepDetails: {
            Attempt: 1,
            NextAttemptTimestamp: new Date(Date.now() + 1000),
          },
        },
      } as any;

      const stepFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("Test error"))
        .mockResolvedValue("result");

      const mockRetryStrategy = jest
        .fn()
        .mockReturnValue({ shouldRetry: true, delaySeconds: 1 });

      const mockHasRunningOperations = jest
        .fn()
        .mockReturnValueOnce(true) // Trigger waitForContinuation in executeStep
        .mockReturnValue(false); // Allow execution after continue

      const stepHandlerWithMocks = createStepHandler(
        mockExecutionContext,
        mockCheckpoint,
        mockParentContext,
        createStepId,
        jest.fn().mockReturnValue({ log: jest.fn() }),
        jest.fn(),
        jest.fn(),
        mockHasRunningOperations,
      );

      const result = await stepHandlerWithMocks("test-step", stepFn, {
        retryStrategy: mockRetryStrategy,
      });

      expect(result).toBe("result");
    });
  });
});
