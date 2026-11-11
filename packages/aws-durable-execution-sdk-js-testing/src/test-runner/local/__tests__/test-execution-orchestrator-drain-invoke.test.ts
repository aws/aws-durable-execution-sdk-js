import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mocked,
} from "vitest";
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

vi.mock("../operations/local-operation-storage");

const mockInvoke = vi.fn();
vi.mock("../invoke-handler", () => ({
  // biome-ignore lint/complexity/useArrowFunction: used with `new`, so it must be a constructible function
  InvokeHandler: vi.fn().mockImplementation(function () {
    return {
      invoke: mockInvoke,
      buildContext: vi.fn(() => ({})),
    };
  }),
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
      pauseExecution: vi.fn().mockResolvedValue(undefined),
      resumeExecution: vi.fn().mockResolvedValue(undefined),
      startDurableExecution: vi.fn().mockResolvedValue({
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
      pollCheckpointData: vi.fn().mockReturnValue(new Promise(() => undefined)),
      drainCheckpointData: vi
        .fn()
        .mockResolvedValue({ operations: [invokeStart] }),
      updateCheckpointData: vi.fn().mockResolvedValue(undefined),
      startInvocation: vi.fn(),
      completeInvocation: vi.fn().mockResolvedValue({
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
    const neverReturns = vi.fn(() => new Promise(() => undefined));
    functionStorage.registerFunction("neverReturns", neverReturns);

    const indexedOperations = new IndexedOperations([]);
    const operationStorage = new LocalOperationStorage(
      new OperationWaitManager(indexedOperations),
      indexedOperations,
      {
        sendCallbackFailure: vi.fn(),
        sendCallbackSuccess: vi.fn(),
        sendCallbackHeartbeat: vi.fn(),
      },
      vi.fn(),
    ) as Mocked<LocalOperationStorage>;

    const orchestrator = new TestExecutionOrchestrator(
      vi.fn(),
      operationStorage,
      checkpointApi,
      functionStorage,
      { enabled: true, fakeClock: clock },
    );

    const result = await orchestrator.executeHandler();
    expect(result.status).toBe(OperationStatus.SUCCEEDED);
    expect(neverReturns).toHaveBeenCalledTimes(1);

    // An unrelated execution on the same clock waits 3 s. Nothing runs, so the clock moves.
    const unrelated: Mocked<SkipTimeParticipant> = {
      isBusy: vi.fn(() => false),
      runningInvocation: vi.fn(() => undefined),
      hasPendingWork: vi.fn(() => true),
      earliestDeadline: vi.fn(() => 3000),
      applyDeadline: vi.fn(),
      onClockAdvanced: vi.fn(),
    };
    const coordinator = SkipTimeCoordinator.forClock(clock);
    coordinator.register(unrelated);
    coordinator.advance();

    expect(Date.now()).toBe(3000);
    expect(unrelated.applyDeadline).toHaveBeenCalledWith(3000);
    coordinator.unregister(unrelated);
  });
});
