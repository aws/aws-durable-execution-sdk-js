import {
  createDurableContext,
  DurableExecution,
} from "../../context/durable-context/durable-context";
import {
  ExecutionContext,
  DurableContext,
  DurableExecutionMode,
  DurableLogger,
} from "../../types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import {
  OperationType,
  OperationStatus,
  OperationAction,
  CheckpointDurableExecutionRequest,
} from "../../types/wire";
import { hashId, getStepData } from "../../utils/step-id-utils/step-id-utils";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { Serdes, SerdesContext } from "../../utils/serdes/serdes";

jest.mock("../../termination-manager/termination-manager");

/**
 * Composed tests for child context ser/des round-trip behavior.
 *
 * These tests use a real DurableContext with mocked checkpoint to verify that
 * runInChildContext applies the serialize/deserialize round-trip on first execution,
 * ensuring the first-run result matches what replay would return.
 */
describe("runInChildContext serdes round-trip", () => {
  let mockExecutionContext: ExecutionContext;
  let mockParentContext: any;
  let durableContext: DurableContext<DurableLogger>;
  let checkpointCalls: any[];
  let mockDurableExecution: DurableExecution;

  /**
   * Asymmetric serdes: serialize uppercases, deserialize is identity.
   * If first-run returns "HELLO", the round-trip was applied.
   * If first-run returns "hello", the raw result was returned without the round-trip.
   */
  const uppercaseSerdes: Serdes<string> = {
    serialize: async (
      value: string | undefined,
      _context: SerdesContext,
    ): Promise<string | undefined> =>
      value === undefined ? undefined : value.toUpperCase(),
    deserialize: async (
      data: string | undefined,
      _context: SerdesContext,
    ): Promise<string | undefined> => data,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    checkpointCalls = [];

    mockDurableExecution = {
      checkpointManager: {
        checkpoint: jest
          .fn()
          .mockImplementation((_stepId: string, data: any) => {
            const checkpointData = {
              CheckpointToken: "mock-token",
              Updates: [data],
            };
            checkpointCalls.push({
              checkpointToken: "mock-token",
              data: checkpointData,
            });
            return Promise.resolve({ CheckpointToken: "mock-token" });
          }),
        force: jest.fn(),
        setTerminating: jest.fn(),
        hasPendingAncestorCompletion: jest.fn(),
        markAncestorFinished: jest.fn(),
        markOperationState: jest.fn(),
        markOperationAwaited: jest.fn(),
        waitForStatusChange: jest.fn().mockResolvedValue(undefined),
        waitForRetryTimer: jest.fn().mockResolvedValue(undefined),
        getOperationState: jest.fn(),
        getAllOperations: jest.fn().mockReturnValue([]),
      },
    } as any;

    const mockTerminationManager = {
      terminate: jest.fn(),
      getTerminationPromise: jest.fn().mockResolvedValue({}),
      isTerminated: false,
      terminationPromise: Promise.resolve(),
      handleTermination: jest.fn(),
      addListener: jest.fn(),
    } as unknown as TerminationManager;

    mockExecutionContext = {
      durableExecutionClient: {
        getExecutionState: jest.fn().mockResolvedValue({}),
        checkpoint: jest
          .fn()
          .mockImplementation((data: CheckpointDurableExecutionRequest) => {
            const checkpointToken = data.CheckpointToken;
            checkpointCalls.push({ checkpointToken, data });
            return Promise.resolve({ CheckpointToken: "mock-token" });
          }),
      },
      _stepData: {},
      terminationManager: mockTerminationManager,
      durableExecutionArn: "mock-execution-arn",
      pendingCompletions: new Set<string>(),
      getStepData: jest.fn((stepId: string) => {
        return getStepData(mockExecutionContext._stepData, stepId);
      }),
      isOperationUpdatedBetweenInvocation: jest.fn().mockReturnValue(false),
      requestId: "mock-request-id",
      tenantId: undefined,
      getRemainingTimeMs: (): number => Infinity,
    } satisfies ExecutionContext;

    mockParentContext = { awsRequestId: "mock-request-id" };

    durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );
  });

  test("should return deserialize(serialize(result)) on first run for small payloads", async () => {
    const result = await durableContext.runInChildContext(
      "serdes-child",
      async (_childContext) => {
        return "hello";
      },
      { serdes: uppercaseSerdes },
    );

    // serialize("hello") = "HELLO", deserialize("HELLO") = "HELLO"
    expect(result).toBe("HELLO");
  });

  test("should checkpoint the serialized value", async () => {
    await durableContext.runInChildContext(
      "serdes-child",
      async (_childContext) => {
        return "hello";
      },
      { serdes: uppercaseSerdes },
    );

    // Find the SUCCEED checkpoint call
    const succeedCheckpoint = checkpointCalls.find(
      (call) => call.data.Updates[0].Action === OperationAction.SUCCEED,
    );
    expect(succeedCheckpoint).toBeDefined();
    expect(succeedCheckpoint.data.Updates[0].Payload).toBe("HELLO");
  });

  test("should round-trip result for virtual contexts (consistent with other modes)", async () => {
    const result = await durableContext.runInChildContext(
      "virtual-child",
      async (_childContext) => {
        return "hello";
      },
      { serdes: uppercaseSerdes, virtualContext: true },
    );

    // Virtual contexts never checkpoint, but the returned value still passes
    // through the serdes round-trip so behavior is consistent with the small-
    // and large-payload modes. serialize("hello") = "HELLO", deserialize = id.
    expect(result).toBe("HELLO");
    // Virtual contexts should still not checkpoint
    expect(checkpointCalls).toHaveLength(0);
  });

  test("should round-trip result for large payloads (ReplayChildren mode)", async () => {
    const largeValue = "x".repeat(300 * 1024); // >256KB

    const result = await durableContext.runInChildContext(
      "large-child",
      async (_childContext) => {
        return largeValue;
      },
      { serdes: uppercaseSerdes },
    );

    // Large payloads trigger ReplayChildren, but the returned value still
    // passes through the serdes round-trip, consistent with the other modes.
    // serialize uppercases, deserialize is identity.
    expect(result).toBe(largeValue.toUpperCase());
  });

  test("should deserialize correctly on replay (completed child context)", async () => {
    // Simulate a completed child context with serialized result in checkpoint
    mockExecutionContext._stepData = {
      [hashId("1")]: {
        Id: "1",
        Type: OperationType.CONTEXT,
        StartTimestamp: new Date(),
        Status: OperationStatus.SUCCEEDED,
        ContextDetails: {
          Result: "HELLO", // This is the serialized (uppercased) value
        },
      },
    };

    const result = await durableContext.runInChildContext(
      "serdes-child",
      async (_childContext) => {
        // This should NOT execute since the context is already completed
        return "should-not-run";
      },
      { serdes: uppercaseSerdes },
    );

    // On replay: deserialize("HELLO") = "HELLO"
    expect(result).toBe("HELLO");
  });

  test("first run and replay should return the same value", async () => {
    // First run
    const firstRunResult = await durableContext.runInChildContext(
      "serdes-child",
      async (_childContext) => {
        return "hello";
      },
      { serdes: uppercaseSerdes },
    );

    // Now simulate replay by creating a new context with completed step data
    mockExecutionContext._stepData = {
      [hashId("1")]: {
        Id: "1",
        Type: OperationType.CONTEXT,
        StartTimestamp: new Date(),
        Status: OperationStatus.SUCCEEDED,
        ContextDetails: {
          Result: "HELLO", // checkpointed from first run
        },
      },
    };

    const replayContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ReplayMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );

    const replayResult = await replayContext.runInChildContext(
      "serdes-child",
      async (_childContext) => {
        return "hello"; // won't execute
      },
      { serdes: uppercaseSerdes },
    );

    // Both should be identical
    expect(firstRunResult).toBe(replayResult);
    expect(firstRunResult).toBe("HELLO");
  });

  test("ReplayChildren replay applies the same serdes round-trip as first run", async () => {
    // Simulate a completed large-payload child context (ReplayChildren mode):
    // the checkpoint holds only a summary and replay re-executes the child fn.
    mockExecutionContext._stepData = {
      [hashId("1")]: {
        Id: "1",
        Type: OperationType.CONTEXT,
        StartTimestamp: new Date(),
        Status: OperationStatus.SUCCEEDED,
        ContextDetails: {
          Result: "[summary]",
          ReplayChildren: true,
        },
      },
    };

    const result = await durableContext.runInChildContext(
      "large-child",
      async (_childContext) => {
        // Re-executed on replay because ReplayChildren is set.
        return "hello";
      },
      { serdes: uppercaseSerdes },
    );

    // Replay re-executes the fn (-> "hello") then round-trips:
    // serialize("hello") = "HELLO", deserialize("HELLO") = "HELLO".
    // Matches the first-run large-payload behavior.
    expect(result).toBe("HELLO");
  });
});
