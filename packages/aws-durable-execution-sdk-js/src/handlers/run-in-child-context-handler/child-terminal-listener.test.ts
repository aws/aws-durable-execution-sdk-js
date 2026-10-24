import { createRunInChildContextHandler } from "./run-in-child-context-handler";
import {
  ChildTerminalOutcome,
  notifyChildTerminal,
  withChildTerminalListener,
} from "./child-terminal-listener";
import { ExecutionContext } from "../../types";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import {
  createMockCheckpoint,
  CheckpointFunction,
} from "../../testing/mock-checkpoint";
import { OperationAction, OperationStatus } from "../../types/wire";
import { getStepData, hashId } from "../../utils/step-id-utils/step-id-utils";

describe("child terminal listener", () => {
  it("calls the listener once and ignores later reports", () => {
    const listener = jest.fn();
    const options = withChildTerminalListener({}, listener);

    notifyChildTerminal(options, "SUCCEEDED");
    notifyChildTerminal(options, "FAILED");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("SUCCEEDED");
  });

  it("does nothing for options without a listener or no options", () => {
    expect(() => notifyChildTerminal({}, "FAILED")).not.toThrow();
    expect(() => notifyChildTerminal(undefined, "FAILED")).not.toThrow();
  });
});

describe("runInChildContext reports its terminal outcome", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockCheckpoint: jest.MockedFunction<CheckpointFunction>;
  let runInChildContextHandler: ReturnType<
    typeof createRunInChildContextHandler
  >;
  // Ordered record of terminal checkpoints and listener calls.
  let events: string[];

  const listenerOptions = (
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> =>
    withChildTerminalListener(extra, (outcome: ChildTerminalOutcome) => {
      events.push(`listener:${outcome}`);
    }) as Record<string, unknown>;

  beforeEach(() => {
    jest.resetAllMocks();
    events = [];

    mockExecutionContext = {
      _stepData: {},
      terminationManager: {
        terminate: jest.fn(),
        getTerminationPromise: jest.fn(),
      },
      getStepData: jest.fn((stepId: string) =>
        getStepData(mockExecutionContext._stepData, stepId),
      ),
    } as unknown as jest.Mocked<ExecutionContext>;

    mockCheckpoint = createMockCheckpoint();
    mockCheckpoint.mockImplementation(async (_id, data) => {
      if (
        data.Action === OperationAction.SUCCEED ||
        data.Action === OperationAction.FAIL
      ) {
        events.push(`checkpoint:${data.Action}`);
      }
    });

    runInChildContextHandler = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      { awsRequestId: "mock-request-id" } as never,
      jest.fn().mockReturnValue(TEST_CONSTANTS.CHILD_CONTEXT_ID),
      jest.fn().mockReturnValue({
        log: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      }),
      jest.fn().mockReturnValue({
        _stepPrefix: TEST_CONSTANTS.CHILD_CONTEXT_ID,
      }),
      "parent-step-123",
    );
  });

  it("reports SUCCEEDED right after queuing the SUCCEED checkpoint, before the result is deserialized", async () => {
    const serdes = {
      serialize: async (value: unknown) => JSON.stringify(value),
      deserialize: async (data?: string) => {
        events.push("deserialize");
        return data ? JSON.parse(data) : undefined;
      },
    };

    await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      async () => "value",
      listenerOptions({ serdes }) as never,
    );

    expect(events).toEqual([
      "checkpoint:SUCCEED",
      "listener:SUCCEEDED",
      "deserialize",
    ]);
  });

  it("reports FAILED right after queuing the FAIL checkpoint", async () => {
    await expect(
      runInChildContextHandler(
        TEST_CONSTANTS.CHILD_CONTEXT_NAME,
        async () => {
          throw new Error("boom");
        },
        listenerOptions() as never,
      ),
    ).rejects.toThrow("boom");

    expect(events).toEqual(["checkpoint:FAIL", "listener:FAILED"]);
  });

  it("reports for a virtual context, which queues no checkpoint", async () => {
    await runInChildContextHandler(
      TEST_CONSTANTS.CHILD_CONTEXT_NAME,
      async () => "value",
      listenerOptions({ virtualContext: true }) as never,
    );
    await expect(
      runInChildContextHandler(
        TEST_CONSTANTS.CHILD_CONTEXT_NAME,
        async () => {
          throw new Error("boom");
        },
        listenerOptions({ virtualContext: true }) as never,
      ),
    ).rejects.toThrow("boom");

    expect(events).toEqual(["listener:SUCCEEDED", "listener:FAILED"]);
  });

  it.each([
    [OperationStatus.SUCCEEDED, "SUCCEEDED"],
    [OperationStatus.FAILED, "FAILED"],
  ])(
    "reports a context already %s in an earlier invocation synchronously",
    async (status, outcome) => {
      mockExecutionContext._stepData = {
        [hashId(TEST_CONSTANTS.CHILD_CONTEXT_ID)]: {
          Id: hashId(TEST_CONSTANTS.CHILD_CONTEXT_ID),
          Type: "CONTEXT",
          Name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
          Status: status,
          ContextDetails:
            status === OperationStatus.SUCCEEDED
              ? { Result: JSON.stringify("cached") }
              : { Error: { ErrorMessage: "boom" } },
        },
      } as never;

      const promise = runInChildContextHandler(
        TEST_CONSTANTS.CHILD_CONTEXT_NAME,
        async () => "not-run",
        listenerOptions() as never,
      );
      // No await has happened yet.
      expect(events).toEqual([`listener:${outcome}`]);
      await promise.catch(() => undefined);
    },
  );
});
