import {
  createMockCheckpoint,
  CheckpointFunction,
} from "../../testing/mock-checkpoint";
import { createWaitForConditionHandler } from "./wait-for-condition-handler";
import {
  ExecutionContext,
  WaitForConditionCheckFunc,
  WaitForConditionConfig,
} from "../../types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

describe("WaitForCondition Handler Timing Tests", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockCheckpoint: jest.MockedFunction<CheckpointFunction>;
  let _mockParentContext: any;
  let createStepId: jest.Mock;
  let _waitForConditionHandler: ReturnType<
    typeof createWaitForConditionHandler
  >;
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
    _mockParentContext = { getRemainingTimeInMillis: (): number => 30000 };
    createStepId = jest.fn().mockReturnValue("test-step-id");

    _waitForConditionHandler = createWaitForConditionHandler(
      mockExecutionContext,
      mockCheckpoint,
      createStepId,
      jest.fn().mockReturnValue({ log: jest.fn() }),
      jest.fn(),
      jest.fn(),
      jest.fn().mockReturnValue(false),
      undefined, // parentId
    );
  });

  describe("WaitForCondition Timing and Concurrency Tests", () => {
    test("should terminate when retry is scheduled and no running operations", async () => {
      const checkFn: WaitForConditionCheckFunc<{ complete: boolean }> = jest
        .fn()
        .mockReturnValue({ complete: false });

      const config: WaitForConditionConfig<{ complete: boolean }> = {
        initialState: { complete: false },
        waitStrategy: () => ({ shouldContinue: true, delaySeconds: 1 }),
      };

      const mockHasRunningOperations = jest.fn().mockReturnValue(false);

      const waitForConditionHandlerWithMocks = createWaitForConditionHandler(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        jest.fn().mockReturnValue({ log: jest.fn() }),
        jest.fn(),
        jest.fn(),
        mockHasRunningOperations,
        undefined, // parentId
      );

      waitForConditionHandlerWithMocks("test-wait", checkFn, config);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.RETRY_SCHEDULED,
        message: expect.stringContaining("test-wait"),
      });
    });

    test("should wait for pending condition and continue main loop execution", async () => {
      const stepId = "test-step-id";
      const hashedStepId = hashId(stepId);

      // Create a waitForCondition handler that will hit the PENDING path then succeed
      const mockGetStepData = jest
        .fn()
        .mockReturnValueOnce({
          Id: hashedStepId,
          Status: OperationStatus.PENDING,
          StepDetails: { Attempt: 1 },
        })
        .mockReturnValue({
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          StepDetails: { Result: JSON.stringify({ complete: true }) },
        });

      mockExecutionContext.getStepData = mockGetStepData;

      const checkFn: WaitForConditionCheckFunc<{ complete: boolean }> = jest
        .fn()
        .mockReturnValue({ complete: true });

      const config: WaitForConditionConfig<{ complete: boolean }> = {
        initialState: { complete: false },
        waitStrategy: () => ({ shouldContinue: false, delaySeconds: 0 }),
      };

      // Mock hasRunningOperations to return true initially (to trigger waitForContinuation)
      // then false to allow normal execution
      const mockHasRunningOperations = jest
        .fn()
        .mockReturnValueOnce(true)
        .mockReturnValue(false);

      const waitForConditionHandlerWithMocks = createWaitForConditionHandler(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        jest.fn().mockReturnValue({ log: jest.fn() }),
        jest.fn(),
        jest.fn(),
        mockHasRunningOperations,
        undefined, // parentId
      );

      const result = await waitForConditionHandlerWithMocks(
        "test-wait",
        checkFn,
        config,
      );

      // Verify the continue statement was executed by checking the result
      expect(result).toEqual({ complete: true });
      expect(mockGetStepData).toHaveBeenCalled(); // Called multiple times due to main loop
    });

    test("should retry condition check and continue main loop", async () => {
      const stepId = "test-step-id";
      const hashedStepId = hashId(stepId);

      const checkFn: WaitForConditionCheckFunc<{ count: number }> = jest
        .fn()
        .mockReturnValueOnce({ count: 1 })
        .mockReturnValueOnce({ count: 2 });

      const config: WaitForConditionConfig<{ count: number }> = {
        initialState: { count: 0 },
        waitStrategy: (state, _attempt) => ({
          shouldContinue: state.count < 2, // Continue until count reaches 2
          delaySeconds: 1,
        }),
      };

      // Mock getStepData to simulate retry flow
      const mockGetStepData = jest
        .fn()
        .mockReturnValueOnce(undefined) // First execution - will retry
        .mockReturnValueOnce({
          Id: hashedStepId,
          Status: OperationStatus.PENDING,
          StepDetails: {
            Attempt: 1,
            Result: JSON.stringify({ count: 1 }),
          },
        })
        .mockReturnValue(undefined); // After continue, proceed with final execution

      mockExecutionContext.getStepData = mockGetStepData;

      // Mock hasRunningOperations to trigger waitForContinuation, then allow execution
      const mockHasRunningOperations = jest
        .fn()
        .mockReturnValueOnce(true) // Trigger waitForContinuation in retry path
        .mockReturnValue(false); // Allow execution after continue

      const waitForConditionHandlerWithMocks = createWaitForConditionHandler(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        jest.fn().mockReturnValue({ log: jest.fn() }),
        jest.fn(),
        jest.fn(),
        mockHasRunningOperations,
        undefined, // parentId
      );

      const result = await waitForConditionHandlerWithMocks(
        "test-wait",
        checkFn,
        config,
      );

      expect(result).toEqual({ count: 2 });
      expect(mockHasRunningOperations).toHaveBeenCalled();
      expect(checkFn).toHaveBeenCalledTimes(2);
    });

    test("should handle condition check with scheduled delay and main loop continuation", async () => {
      const stepId = "test-step-id";
      const hashedStepId = hashId(stepId);

      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.READY,
          StepDetails: {
            Attempt: 1,
            NextAttemptTimestamp: new Date(Date.now() + 1000),
            Result: JSON.stringify({ progress: 50 }),
          },
        },
      } as any;

      const checkFn: WaitForConditionCheckFunc<{ progress: number }> = jest
        .fn()
        .mockReturnValueOnce({ progress: 75 })
        .mockReturnValueOnce({ progress: 100 });

      const config: WaitForConditionConfig<{ progress: number }> = {
        initialState: { progress: 0 },
        waitStrategy: (state, _attempt) => ({
          shouldContinue: state.progress < 100,
          delaySeconds: 2,
        }),
      };

      // Mock getStepData to simulate the flow: READY -> retry -> PENDING -> continue -> success
      const mockGetStepData = jest
        .fn()
        .mockReturnValueOnce({
          Id: hashedStepId,
          Status: OperationStatus.READY,
          StepDetails: {
            Attempt: 1,
            Result: JSON.stringify({ progress: 50 }),
          },
        })
        .mockReturnValueOnce({
          Id: hashedStepId,
          Status: OperationStatus.PENDING,
          StepDetails: { Attempt: 2 },
        })
        .mockReturnValueOnce(undefined); // After continue, proceed with final execution

      mockExecutionContext.getStepData = mockGetStepData;

      const mockHasRunningOperations = jest
        .fn()
        .mockReturnValueOnce(true) // Trigger waitForContinuation in retry
        .mockReturnValue(false); // Allow execution after continue

      const waitForConditionHandlerWithMocks = createWaitForConditionHandler(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        jest.fn().mockReturnValue({ log: jest.fn() }),
        jest.fn(),
        jest.fn(),
        mockHasRunningOperations,
        undefined, // parentId
      );

      const result = await waitForConditionHandlerWithMocks(
        "test-wait",
        checkFn,
        config,
      );

      expect(result).toEqual({ progress: 100 });
      expect(checkFn).toHaveBeenCalledTimes(2);
    });

    test("should handle concurrent operations during retry with main loop", async () => {
      const stepId = "test-step-id";
      const hashedStepId = hashId(stepId);

      const checkFn: WaitForConditionCheckFunc<{ attempts: number }> = jest
        .fn()
        .mockReturnValueOnce({ attempts: 1 })
        .mockReturnValueOnce({ attempts: 2 })
        .mockReturnValueOnce({ attempts: 3 });

      const config: WaitForConditionConfig<{ attempts: number }> = {
        initialState: { attempts: 0 },
        waitStrategy: (state) => ({
          shouldContinue: state.attempts < 3,
          delaySeconds: 1,
        }),
      };

      // Simulate multiple loop iterations with different states
      const mockGetStepData = jest
        .fn()
        .mockReturnValueOnce(undefined) // First execution - will retry
        .mockReturnValueOnce({
          Id: hashedStepId,
          Status: OperationStatus.PENDING,
          StepDetails: { Attempt: 1 },
        })
        .mockReturnValueOnce({
          Id: hashedStepId,
          Status: OperationStatus.READY,
          StepDetails: {
            Attempt: 2,
            Result: JSON.stringify({ attempts: 1 }),
          },
        })
        .mockReturnValueOnce({
          Id: hashedStepId,
          Status: OperationStatus.PENDING,
          StepDetails: { Attempt: 2 },
        })
        .mockReturnValue(undefined); // Final execution

      mockExecutionContext.getStepData = mockGetStepData;

      // Mock concurrent operations scenario
      const mockHasRunningOperations = jest
        .fn()
        .mockReturnValueOnce(true) // First retry - has operations
        .mockReturnValueOnce(false) // Allow continuation
        .mockReturnValueOnce(true) // Second retry - has operations
        .mockReturnValue(false); // Allow final execution

      const waitForConditionHandlerWithMocks = createWaitForConditionHandler(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        jest.fn().mockReturnValue({ log: jest.fn() }),
        jest.fn(),
        jest.fn(),
        mockHasRunningOperations,
        undefined, // parentId
      );

      const result = await waitForConditionHandlerWithMocks(
        "test-wait",
        checkFn,
        config,
      );

      expect(result).toEqual({ attempts: 3 });
      expect(mockHasRunningOperations).toHaveBeenCalled();
      expect(checkFn).toHaveBeenCalledTimes(3); // Check function called 3 times
    });
  });
});
