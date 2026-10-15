import { TestExecutionOrchestrator } from "../test-execution-orchestrator";
import { LocalOperationStorage } from "../operations/local-operation-storage";
import {
  createCheckpointToken,
  createExecutionId,
  createInvocationId,
} from "../../../checkpoint-server/utils/tagged-strings";
import {
  DurableExecutionInvocationOutput,
  InvocationStatus,
  OperationAction,
  OperationStatus,
  OperationType,
} from "@aws/durable-execution-sdk-js";
import { EventType } from "@aws-sdk/client-lambda";
import { OperationWaitManager } from "../operations/operation-wait-manager";
import { IndexedOperations } from "../../common/indexed-operations";
import { OperationEvents } from "../../common/operations/operation-with-data";
import { CheckpointOperation } from "../../../checkpoint-server/storage/checkpoint-manager";
import { FunctionStorage } from "../operations/function-storage";
import { ILocalDurableTestRunnerFactory } from "../interfaces/durable-test-runner-factory";
import { CheckpointApiClient } from "../api-client/checkpoint-api-client";
import { defaultLogger } from "../../../logger";
import { realSetTimeout } from "../real-timers/real-timers";

jest.mock("../operations/local-operation-storage");

const mockInvoke = jest.fn();

jest.mock("../invoke-handler", () => ({
  InvokeHandler: jest.fn().mockImplementation(() => ({
    invoke: mockInvoke,
  })),
}));

// Record every real-timer delay the orchestrator asks for, while keeping the real timer.
// Asserting on the requested delays, not on elapsed time, keeps the tests stable under load.
jest.mock("../real-timers/real-timers", () => {
  const actual = jest.requireActual<
    typeof import("../real-timers/real-timers")
  >("../real-timers/real-timers");
  return {
    ...actual,
    realSetTimeout: jest.fn(
      (callback: () => void, ms?: number): ReturnType<typeof setTimeout> =>
        actual.realSetTimeout(callback, ms),
    ),
  };
});

function requestedRealDelays(): (number | undefined)[] {
  return (realSetTimeout as unknown as jest.Mock).mock.calls.map(
    (call: unknown[]) => call[1] as number | undefined,
  );
}

/**
 * How executeHandler ends: it collects the last checkpoint updates with a drain instead of
 * waiting a fixed time, and keeps the fixed wait only before rejecting.
 */
describe("TestExecutionOrchestrator completion", () => {
  const executionId = createExecutionId("test-execution-id");
  const initialOperationEvents: OperationEvents[] = [
    {
      events: [
        {
          Id: "execution-id",
          EventId: 1,
          EventType: EventType.ExecutionStarted,
        },
      ],
      operation: {
        Id: "execution-id",
        StartTimestamp: new Date(),
        Status: OperationStatus.STARTED,
        Type: OperationType.EXECUTION,
        ExecutionDetails: {},
      },
    },
  ];
  const drainedOperation: CheckpointOperation = {
    operation: {
      Id: "step-id",
      Type: OperationType.STEP,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date(),
    },
    update: {
      Id: "step-id",
      Type: OperationType.STEP,
      Action: OperationAction.SUCCEED,
    },
    events: [],
  };
  const nonResolvingPromise = new Promise<never>(() => {
    // never resolve
  });

  let operationStorage: jest.Mocked<LocalOperationStorage>;
  let checkpointApi: CheckpointApiClient & {
    drainCheckpointData: jest.Mock;
  };

  function createOrchestrator(
    api: CheckpointApiClient = checkpointApi,
  ): TestExecutionOrchestrator {
    return new TestExecutionOrchestrator(
      jest.fn(),
      operationStorage,
      api,
      new FunctionStorage({
        createRunner: jest.fn(),
      } as unknown as ILocalDurableTestRunnerFactory),
      { enabled: false },
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoke.mockReset();

    const indexedOperations = new IndexedOperations([]);
    operationStorage = new LocalOperationStorage(
      new OperationWaitManager(indexedOperations),
      indexedOperations,
      {
        sendCallbackFailure: jest.fn(),
        sendCallbackSuccess: jest.fn(),
        sendCallbackHeartbeat: jest.fn(),
      },
      jest.fn(),
    ) as jest.Mocked<LocalOperationStorage>;
    operationStorage.populateOperations = jest.fn();

    checkpointApi = {
      pauseExecution: jest.fn().mockResolvedValue(undefined),
      resumeExecution: jest.fn().mockResolvedValue(undefined),
      startDurableExecution: jest.fn().mockResolvedValue({
        executionId,
        checkpointToken: createCheckpointToken("token"),
        operationEvents: initialOperationEvents,
        invocationId: createInvocationId(),
        updatedOperationIds: [],
      }),
      pollCheckpointData: jest.fn().mockReturnValue(nonResolvingPromise),
      drainCheckpointData: jest
        .fn()
        .mockResolvedValue({ operations: [drainedOperation] }),
      updateCheckpointData: jest.fn().mockResolvedValue(undefined),
      startInvocation: jest.fn(),
      completeInvocation: jest.fn().mockResolvedValue({
        event: {
          EventType: EventType.InvocationCompleted,
          InvocationCompletedDetails: {
            RequestId: "request-id",
            StartTimestamp: new Date(),
            EndTimestamp: new Date(),
          },
        },
        hasDirtyOperations: false,
      }),
    };

    mockInvoke.mockResolvedValue({
      Status: InvocationStatus.SUCCEEDED,
      Result: JSON.stringify("ok"),
    } satisfies DurableExecutionInvocationOutput);
  });

  it("drains the remaining updates after the final update, and stores them", async () => {
    const result = await createOrchestrator().executeHandler();

    expect(result.status).toBe(OperationStatus.SUCCEEDED);
    expect(checkpointApi.drainCheckpointData).toHaveBeenCalledTimes(1);
    expect(checkpointApi.drainCheckpointData).toHaveBeenCalledWith(executionId);
    // The drain must follow the final update, or it could miss what that update produced.
    const updateOrder = (checkpointApi.updateCheckpointData as jest.Mock).mock
      .invocationCallOrder[0];
    expect(
      checkpointApi.drainCheckpointData.mock.invocationCallOrder[0],
    ).toBeGreaterThan(updateOrder);
    expect(operationStorage.populateOperations).toHaveBeenLastCalledWith([
      drainedOperation,
    ]);
  });

  it("stops polling before draining, and aborts the poll signal only after", async () => {
    let signal: AbortSignal | undefined;
    (checkpointApi.pollCheckpointData as jest.Mock).mockImplementation(
      (_id: unknown, s: AbortSignal) => {
        signal = s;
        return nonResolvingPromise;
      },
    );
    let abortedDuringDrain: boolean | undefined;
    checkpointApi.drainCheckpointData.mockImplementation(async () => {
      abortedDuringDrain = signal?.aborted;
      return { operations: [] };
    });

    await createOrchestrator().executeHandler();

    // An abort during the drain could cancel a poll that carries the last updates.
    expect(abortedDuringDrain).toBe(false);
    expect(signal?.aborted).toBe(true);
    // The loop sent the first poll only, so stopping prevented any further poll.
    expect(checkpointApi.pollCheckpointData).toHaveBeenCalledTimes(1);
  });

  it("keeps the last updates when the poll client cancels on abort", async () => {
    // A client may reject its in-flight poll once the signal aborts. Here the poll that
    // carries the last update is answered just before the drain, as the worker does.
    let resolveInFlightPoll: (() => void) | undefined;
    (checkpointApi.pollCheckpointData as jest.Mock).mockImplementation(
      (_id: unknown, s: AbortSignal) =>
        new Promise((resolve, reject) => {
          resolveInFlightPoll = () =>
            resolve({ operations: [drainedOperation] });
          s.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    checkpointApi.drainCheckpointData.mockImplementation(async () => {
      resolveInFlightPoll?.();
      return { operations: [] };
    });

    await createOrchestrator().executeHandler();

    expect(operationStorage.populateOperations).toHaveBeenCalledWith([
      drainedOperation,
    ]);
  });

  it("resolves a successful execution without a fixed wait", async () => {
    const result = await createOrchestrator().executeHandler();

    expect(result.status).toBe(OperationStatus.SUCCEEDED);
    // The old code asked for a 100 ms real timer. Now the only real timer is the 0 ms one
    // that settles the execution.
    expect(requestedRealDelays()).toEqual([0]);
  });

  it("keeps the fixed wait before rejecting", async () => {
    mockInvoke.mockRejectedValue(new Error("handler crashed"));

    await expect(createOrchestrator().executeHandler()).rejects.toThrow(
      "handler crashed",
    );

    expect(requestedRealDelays()).toEqual([100, 0]);
    expect(checkpointApi.drainCheckpointData).toHaveBeenCalledTimes(1);
  });

  it("handles malformed drained updates like malformed polled updates", async () => {
    const malformedWait: CheckpointOperation = {
      operation: {
        Id: "wait-id",
        Type: OperationType.WAIT,
        Status: OperationStatus.STARTED,
        StartTimestamp: new Date(),
      },
      update: {
        Id: "wait-id",
        Type: OperationType.WAIT,
        Action: OperationAction.START,
      },
      events: [],
    };
    checkpointApi.drainCheckpointData.mockResolvedValue({
      operations: [malformedWait],
    });

    await expect(createOrchestrator().executeHandler()).resolves.toMatchObject({
      status: OperationStatus.SUCCEEDED,
    });
    expect(operationStorage.populateOperations).toHaveBeenCalledWith([
      malformedWait,
    ]);
  });

  it("surfaces a failed drain request when the execution succeeded", async () => {
    checkpointApi.drainCheckpointData.mockRejectedValue(
      new Error("drain failed"),
    );

    await expect(createOrchestrator().executeHandler()).rejects.toThrow(
      "drain failed",
    );
  });

  it("keeps the execution's own error when the drain also fails, and logs the drain error", async () => {
    const warn = jest
      .spyOn(defaultLogger, "warn")
      .mockImplementation(() => undefined);
    mockInvoke.mockRejectedValue(new Error("handler crashed"));
    const drainError = new Error("drain failed");
    checkpointApi.drainCheckpointData.mockRejectedValue(drainError);

    await expect(createOrchestrator().executeHandler()).rejects.toThrow(
      "handler crashed",
    );
    expect(warn).toHaveBeenCalledWith(expect.any(String), drainError);
    warn.mockRestore();
  });

  it("does not drain when the execution never started", async () => {
    (checkpointApi.startDurableExecution as jest.Mock).mockRejectedValue(
      new Error("start failed"),
    );

    await expect(createOrchestrator().executeHandler()).rejects.toThrow(
      "start failed",
    );
    expect(checkpointApi.drainCheckpointData).not.toHaveBeenCalled();
  });
});
