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

jest.mock("../operations/local-operation-storage");

const mockInvoke = jest.fn();

jest.mock("../invoke-handler", () => ({
  InvokeHandler: jest.fn().mockImplementation(() => ({
    invoke: mockInvoke,
  })),
}));

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

  it("aborts polling before draining", async () => {
    let signal: AbortSignal | undefined;
    (checkpointApi.pollCheckpointData as jest.Mock).mockImplementation(
      (_id: unknown, s: AbortSignal) => {
        signal = s;
        return nonResolvingPromise;
      },
    );
    checkpointApi.drainCheckpointData.mockImplementation(async () => {
      expect(signal?.aborted).toBe(true);
      return { operations: [] };
    });

    await createOrchestrator().executeHandler();

    expect(checkpointApi.drainCheckpointData).toHaveBeenCalledTimes(1);
  });

  it("resolves a successful execution without a fixed wait", async () => {
    // Warm up, so module loading is not timed.
    await createOrchestrator().executeHandler();

    const start = performance.now();
    const result = await createOrchestrator().executeHandler();
    const elapsedMs = performance.now() - start;

    expect(result.status).toBe(OperationStatus.SUCCEEDED);
    // The old fixed wait alone took 100 ms. What is left is a 0 ms timer for the initial
    // invocation and one for settling, about 1 ms each.
    expect(elapsedMs).toBeLessThan(50);
  });

  it("keeps the fixed wait before rejecting", async () => {
    mockInvoke.mockRejectedValue(new Error("handler crashed"));

    const start = performance.now();
    await expect(createOrchestrator().executeHandler()).rejects.toThrow(
      "handler crashed",
    );

    expect(performance.now() - start).toBeGreaterThanOrEqual(90);
    expect(checkpointApi.drainCheckpointData).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed drain when the execution succeeded", async () => {
    checkpointApi.drainCheckpointData.mockRejectedValue(
      new Error("drain failed"),
    );

    await expect(createOrchestrator().executeHandler()).rejects.toThrow(
      "drain failed",
    );
  });

  it("keeps the execution's own error when the drain also fails", async () => {
    mockInvoke.mockRejectedValue(new Error("handler crashed"));
    checkpointApi.drainCheckpointData.mockRejectedValue(
      new Error("drain failed"),
    );

    await expect(createOrchestrator().executeHandler()).rejects.toThrow(
      "handler crashed",
    );
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

  it("works with a client that cannot drain", async () => {
    const { drainCheckpointData: _unused, ...withoutDrain } = checkpointApi;

    const result = await createOrchestrator(withoutDrain).executeHandler();

    expect(result.status).toBe(OperationStatus.SUCCEEDED);
  });
});
