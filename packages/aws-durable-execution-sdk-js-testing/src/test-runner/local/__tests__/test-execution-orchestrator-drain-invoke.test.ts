import { Clock, install } from "@sinonjs/fake-timers";
import { EventType } from "@aws-sdk/client-lambda";
import {
  InvocationStatus,
  OperationAction,
  OperationStatus,
  OperationType,
} from "@aws/durable-execution-sdk-js";
import { TestExecutionOrchestrator } from "../test-execution-orchestrator";
import { LocalOperationStorage } from "../operations/local-operation-storage";
import { OperationWaitManager } from "../operations/operation-wait-manager";
import { IndexedOperations } from "../../common/indexed-operations";
import { FunctionStorage } from "../operations/function-storage";
import { ILocalDurableTestRunnerFactory } from "../interfaces/durable-test-runner-factory";
import { CheckpointApiClient } from "../api-client/checkpoint-api-client";
import { CheckpointOperation } from "../../../checkpoint-server/storage/checkpoint-manager";
import {
  SkipTimeCoordinator,
  SkipTimeParticipant,
} from "../orchestration/skip-time-coordinator";
import {
  createCheckpointToken,
  createExecutionId,
  createInvocationId,
} from "../../../checkpoint-server/utils/tagged-strings";

jest.mock("../operations/local-operation-storage");

const mockInvoke = jest.fn();
jest.mock("../invoke-handler", () => ({
  InvokeHandler: jest.fn().mockImplementation(() => ({
    invoke: mockInvoke,
    buildContext: jest.fn(() => ({})),
  })),
}));

describe("TestExecutionOrchestrator invoke started by the final drain", () => {
  let clock: Clock & { uninstall(): void };

  beforeEach(() => {
    clock = install({ now: 0, toFake: ["Date"] }) as Clock & {
      uninstall(): void;
    };
  });

  afterEach(() => {
    clock.uninstall();
  });

  it("does not hold the fake clock for an invoke that starts after the execution finished", async () => {
    const executionId = createExecutionId("drain-invoke-execution");
    // The handler returned without awaiting this invoke, so its START reaches the runner
    // only through the final drain, after the execution has finished.
    const invokeStart: CheckpointOperation = {
      events: [],
      operation: {
        Id: "invoke-op",
        Type: OperationType.CHAINED_INVOKE,
        Status: OperationStatus.STARTED,
        StartTimestamp: new Date(),
      },
      update: {
        Id: "invoke-op",
        Type: OperationType.CHAINED_INVOKE,
        Action: OperationAction.START,
        ChainedInvokeOptions: { FunctionName: "neverReturns" },
      },
    };
    const checkpointApi: CheckpointApiClient = {
      pauseExecution: jest.fn().mockResolvedValue(undefined),
      resumeExecution: jest.fn().mockResolvedValue(undefined),
      startDurableExecution: jest.fn().mockResolvedValue({
        executionId,
        checkpointToken: createCheckpointToken("token"),
        operationEvents: [
          {
            events: [
              {
                Id: "execution",
                EventId: 1,
                EventType: EventType.ExecutionStarted,
              },
            ],
            operation: {
              Id: "execution",
              Type: OperationType.EXECUTION,
              Status: OperationStatus.STARTED,
              StartTimestamp: new Date(),
              ExecutionDetails: {},
            },
          },
        ],
        invocationId: createInvocationId(),
        updatedOperationIds: [],
      }),
      pollCheckpointData: jest
        .fn()
        .mockReturnValue(new Promise(() => undefined)),
      drainCheckpointData: jest
        .fn()
        .mockResolvedValue({ operations: [invokeStart] }),
      updateCheckpointData: jest.fn().mockResolvedValue(undefined),
      startInvocation: jest.fn(),
      completeInvocation: jest.fn().mockResolvedValue({
        EventType: "InvocationCompleted",
        InvocationCompletedDetails: {
          RequestId: "request",
          StartTimestamp: new Date(),
          EndTimestamp: new Date(),
        },
      }),
    };
    mockInvoke.mockResolvedValue({
      Status: InvocationStatus.SUCCEEDED,
      Result: JSON.stringify("returned"),
    });

    const functionStorage = new FunctionStorage(
      {} as ILocalDurableTestRunnerFactory,
    );
    const neverReturns = jest.fn(() => new Promise(() => undefined));
    functionStorage.registerFunction("neverReturns", neverReturns);

    const indexedOperations = new IndexedOperations([]);
    const operationStorage = new LocalOperationStorage(
      new OperationWaitManager(indexedOperations),
      indexedOperations,
      {
        sendCallbackFailure: jest.fn(),
        sendCallbackSuccess: jest.fn(),
        sendCallbackHeartbeat: jest.fn(),
      },
      jest.fn(),
    ) as jest.Mocked<LocalOperationStorage>;

    const orchestrator = new TestExecutionOrchestrator(
      jest.fn(),
      operationStorage,
      checkpointApi,
      functionStorage,
      { enabled: true, fakeClock: clock },
    );

    const result = await orchestrator.executeHandler();
    expect(result.status).toBe(OperationStatus.SUCCEEDED);
    expect(neverReturns).toHaveBeenCalledTimes(1);

    // An unrelated execution on the same clock waits 3 s. Nothing runs, so the clock moves.
    const unrelated: jest.Mocked<SkipTimeParticipant> = {
      isBusy: jest.fn(() => false),
      hasPendingWork: jest.fn(() => true),
      earliestDeadline: jest.fn(() => 3000),
      applyDeadline: jest.fn(),
      onClockAdvanced: jest.fn(),
    };
    const coordinator = SkipTimeCoordinator.forClock(clock);
    coordinator.register(unrelated);
    coordinator.advance();

    expect(Date.now()).toBe(3000);
    expect(unrelated.applyDeadline).toHaveBeenCalledWith(3000);
    coordinator.unregister(unrelated);
  });
});
