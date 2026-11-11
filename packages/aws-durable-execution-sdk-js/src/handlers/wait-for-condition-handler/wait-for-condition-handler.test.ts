import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";
import { createWaitForConditionHandler } from "./wait-for-condition-handler";
import {
  ExecutionContext,
  WaitForConditionCheckFunc,
  WaitForConditionConfig,
  OperationSubType,
  DurableLogger,
  OperationLifecycleState,
  DurableExecutionMode,
} from "../../types";
import { OperationType, OperationStatus } from "../../types/wire";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";

import { getActiveContext } from "../../utils/context-tracker/context-tracker";
import { TerminationReason } from "../../termination-manager/types";

// A fake Serdes. The handler passes it to the real safeSerialize and
// safeDeserialize, so the tests stub and assert on its methods.
let fakeSerdes: { serialize: Mock; deserialize: Mock };
const getFakeSerdes = () => fakeSerdes;

// The active context that the real runWithContext sets for one check run.
const activeContextFor = (attempt: number, parentId: string | undefined) => ({
  contextId: "step-1",
  parentId,
  attempt,
  durableExecutionMode: DurableExecutionMode.ExecutionMode,
  operationName: undefined,
  execution: undefined,
});

describe("WaitForCondition Handler", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeSerdes = { serialize: vi.fn(), deserialize: vi.fn() };

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

    createStepId = vi.fn().mockReturnValue("step-1");

    fakeSerdes.serialize.mockImplementation(async (value) =>
      JSON.stringify(value),
    );
    fakeSerdes.deserialize.mockImplementation(async (value) =>
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
        getFakeSerdes,
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = vi
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
        getFakeSerdes,
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = vi
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
        getFakeSerdes,
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> =
        vi.fn();

      // The error is thrown synchronously during handler call, not when awaiting
      try {
        handler(checkFunc, undefined as any);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error).toBeInstanceOf(TypeError);
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

      (mockContext.getStepData as Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
        getFakeSerdes,
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = vi
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
      // The operation counts as EXECUTING while its cached result is
      // deserialized, then COMPLETED.
      expect((mockCheckpoint.markOperationState as Mock).mock.calls).toEqual([
        [stepId, OperationLifecycleState.EXECUTING, expect.any(Object)],
        [stepId, OperationLifecycleState.COMPLETED],
      ]);
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

      (mockContext.getStepData as Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
        getFakeSerdes,
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> =
        vi.fn();
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
        getFakeSerdes,
      );

      const checkFunc: WaitForConditionCheckFunc<number, DurableLogger> = vi
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
        getFakeSerdes,
      );

      let callCount = 0;
      const checkFunc: WaitForConditionCheckFunc<number, DurableLogger> = vi
        .fn()
        .mockImplementation(async () => {
          callCount++;
          return callCount;
        });

      const waitStrategy = vi
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
        getFakeSerdes,
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = vi
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
        getFakeSerdes,
      );

      const activeContexts: unknown[] = [];
      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = vi.fn(
        async () => {
          activeContexts.push(getActiveContext());
          return "result";
        },
      );
      const waitStrategy = vi.fn().mockReturnValue({ shouldContinue: false });
      const config: WaitForConditionConfig<string> = {
        waitStrategy,
        initialState: "initial",
      };

      await handler(checkFunc, config);

      // Verify currentAttempt is passed correctly to both functions.
      // currentAttempt should be 1 on first execution.
      expect(activeContexts).toEqual([activeContextFor(1, "parent-123")]);
      expect(waitStrategy).toHaveBeenCalledWith("result", 1);
    });

    it("should expose attempt = 1 on WaitForConditionContext on the first execution", async () => {
      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
        getFakeSerdes,
      );

      const checkFunc = vi.fn().mockResolvedValue("result");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await handler(checkFunc, config);

      // Fresh execution: no prior checkpointed attempts -> attempt is 1 (1-based).
      expect(checkFunc).toHaveBeenCalledTimes(1);
      expect(checkFunc.mock.calls[0][1]).toHaveProperty("attempt", 1);
      expect(checkFunc.mock.calls[0][1]).toHaveProperty("logger");
    });

    it("should expose attempt reflecting prior retries (1-based) on WaitForConditionContext", async () => {
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

      (mockContext.getStepData as Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
        getFakeSerdes,
      );

      const checkFunc = vi.fn().mockResolvedValue("result");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      await handler(checkFunc, config);

      expect(checkFunc.mock.calls[0][1]).toHaveProperty("attempt", 3);
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

      (mockContext.getStepData as Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        "parent-123",
        getFakeSerdes,
      );

      const activeContexts: unknown[] = [];
      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = vi.fn(
        async () => {
          activeContexts.push(getActiveContext());
          return "result";
        },
      );
      const waitStrategy = vi.fn().mockReturnValue({ shouldContinue: false });
      const config: WaitForConditionConfig<string> = {
        waitStrategy,
        initialState: "initial",
      };

      await handler(checkFunc, config);

      // Verify currentAttempt = Attempt + 1 for both functions.
      // currentAttempt should be Attempt + 1 = 2 + 1 = 3.
      expect(activeContexts).toEqual([activeContextFor(3, "parent-123")]);
      expect(waitStrategy).toHaveBeenCalledWith("result", 3);
    });

    it("should pass incrementing currentAttempt through multiple retries", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);

      // Track the retry cycle - first call has no step data, then subsequent calls have increasing attempt numbers
      let getStepDataCallCount = 0;
      (mockContext.getStepData as Mock).mockImplementation(() => {
        getStepDataCallCount++;

        // First call - no step data (fresh execution)
        if (getStepDataCallCount <= 2) {
          return null;
        }
        // Subsequent calls during retry cycles - simulate step data with increasing attempt number
        // After the first execution, each retry cycle makes 3 getStepData calls:
        //   1. top of executeCheckLogic (state retrieval)
        //   2. after RETRY checkpoint (for attemptEndInfo)
        //   3. after waitForRetryTimer in next iteration's top-of-loop
        // The final succeed cycle makes 2 calls:
        //   1. top of executeCheckLogic (state retrieval)
        //   2. after SUCCEED checkpoint (for attemptEndInfo)
        const attemptNumber = Math.floor((getStepDataCallCount - 2) / 3);
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
        getFakeSerdes,
      );

      const activeContexts: unknown[] = [];
      const checkFunc: WaitForConditionCheckFunc<number, DurableLogger> = vi.fn(
        async () => {
          activeContexts.push(getActiveContext());
          return 10;
        },
      );

      const waitStrategy = vi
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

      // Verify runWithContext also set the correct attempts
      expect(activeContexts).toEqual([
        activeContextFor(1, undefined),
        activeContextFor(2, undefined),
        activeContextFor(3, undefined),
      ]);
    });
  });

  describe("Serdes error handling", () => {
    it("should terminate execution on Serdes error during STARTED state deserialization", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);

      (mockContext as any)._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.STARTED,
        StepDetails: {
          Result: JSON.stringify("checkpointed-state"),
        },
      };

      (mockContext.getStepData as Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      // The real safeDeserialize catches this error, requests termination
      // and returns a promise that never resolves.
      fakeSerdes.deserialize.mockRejectedValueOnce(new Error("bad state"));

      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
        getFakeSerdes,
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = vi
        .fn()
        .mockResolvedValue("new-result");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      // The returned promise never resolves (execution is terminated), so we
      // don't await it -- just yield to the event loop so the handler can run
      // up to the checkpoint-restore point.
      void handler(checkFunc, config);
      await new Promise((resolve) => setImmediate(resolve));

      // The STARTED restore path deserializes through safeDeserialize, which
      // terminates the execution when the serdes fails.
      expect(fakeSerdes.deserialize).toHaveBeenCalledWith(
        JSON.stringify("checkpointed-state"),
        {
          entityId: stepId,
          durableExecutionArn: mockContext.durableExecutionArn,
        },
      );
      expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
        message: "Deserialization failed for step (step-1): bad state",
      });
      expect(checkFunc).not.toHaveBeenCalled();
    });

    it("should terminate execution on Serdes error during READY state deserialization", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);

      (mockContext as any)._stepData[hashedStepId] = {
        Id: hashedStepId,
        Status: OperationStatus.READY,
        StepDetails: {
          Attempt: 1,
          Result: JSON.stringify("checkpointed-state"),
        },
      };

      (mockContext.getStepData as Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      // The real safeDeserialize catches this error, requests termination
      // and returns a promise that never resolves.
      fakeSerdes.deserialize.mockRejectedValueOnce(new Error("bad state"));

      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
        getFakeSerdes,
      );

      const checkFunc: WaitForConditionCheckFunc<string, DurableLogger> = vi
        .fn()
        .mockResolvedValue("new-result");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      // The returned promise never resolves (execution is terminated), so we
      // don't await it -- just yield to the event loop so the handler can run
      // up to the checkpoint-restore point.
      void handler(checkFunc, config);
      await new Promise((resolve) => setImmediate(resolve));

      // The READY restore path deserializes through safeDeserialize, which
      // terminates the execution when the serdes fails.
      expect(fakeSerdes.deserialize).toHaveBeenCalledWith(
        JSON.stringify("checkpointed-state"),
        {
          entityId: stepId,
          durableExecutionArn: mockContext.durableExecutionArn,
        },
      );
      expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
        message: "Deserialization failed for step (step-1): bad state",
      });
      expect(checkFunc).not.toHaveBeenCalled();
    });
  });

  describe("Serdes round-trip consistency", () => {
    it("should pass a round-tripped initialState to the first check", async () => {
      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
        getFakeSerdes,
      );

      const initialState = { count: 0, created: "now" };
      const checkFunc = vi.fn().mockResolvedValue({ count: 1 });
      const config: WaitForConditionConfig<{ count: number }> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState,
      };

      await handler(checkFunc, config);

      const firstCheckState = checkFunc.mock.calls[0][0];
      expect(firstCheckState).toEqual(initialState);
      expect(firstCheckState).not.toBe(initialState);
      expect(fakeSerdes.serialize).toHaveBeenCalledWith(initialState, {
        entityId: "step-1",
        durableExecutionArn: mockContext.durableExecutionArn,
      });
    });

    it("should not run the first check when initialState fails serialization", async () => {
      // The real safeSerialize catches this error, requests termination and
      // returns a promise that never resolves.
      fakeSerdes.serialize.mockRejectedValueOnce(new Error("bad state"));

      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
        getFakeSerdes,
      );

      const checkFunc = vi.fn().mockResolvedValue("ready");
      const config: WaitForConditionConfig<string> = {
        waitStrategy: () => ({ shouldContinue: false }),
        initialState: "initial",
      };

      void handler(checkFunc, config);
      await new Promise((resolve) => setImmediate(resolve));

      expect(checkFunc).not.toHaveBeenCalled();
      expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
        message: "Serialization failed for step (step-1): bad state",
      });
    });

    it("should return the checkpointed value when waitStrategy mutates the state", async () => {
      const handler = createWaitForConditionHandler(
        mockContext,
        mockCheckpoint,
        createStepId,
        createDefaultLogger(),
        undefined,
        getFakeSerdes,
      );

      const checkFunc = vi.fn().mockResolvedValue({ status: "done" });
      const config: WaitForConditionConfig<{ status: string }> = {
        waitStrategy: (state) => {
          state.status = "mutated";
          return { shouldContinue: false };
        },
        initialState: { status: "pending" },
      };

      const result = await handler(checkFunc, config);

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith(
        "step-1",
        expect.objectContaining({
          Action: "SUCCEED",
          Payload: JSON.stringify({ status: "done" }),
        }),
      );
      expect(result).toEqual({ status: "done" });
    });
  });
});
