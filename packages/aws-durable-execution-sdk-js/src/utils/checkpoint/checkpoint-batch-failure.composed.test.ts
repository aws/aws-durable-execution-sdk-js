import { createTestCheckpointManager } from "../../testing/create-test-checkpoint-manager";
import { CheckpointManager } from "./checkpoint-manager";
import { CheckpointUnrecoverableInvocationError } from "../../errors/checkpoint-errors/checkpoint-errors";
import { DurableLogger, ExecutionContext, OperationSubType } from "../../types";
import { OperationAction, OperationType } from "../../types/wire";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { createMockExecutionContext } from "../../testing/mock-context";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import { EventEmitter } from "events";
import { createDefaultLogger } from "../logger/default-logger";
import {
  DurableExecutionClientError,
  DurableExecutionClientErrorScope,
} from "../../errors/durable-execution-client-error/durable-execution-client-error";

jest.mock("../logger/logger", () => ({
  log: jest.fn(),
}));

/**
 * Composed: real CheckpointManager and real TerminationManager, with only the
 * transport faked.
 *
 * These pin the contract `withDurableExecution` relies on when the handler wins
 * the race and a checkpoint batch then fails while the queue is drained. That
 * path cannot learn about the failure from `waitForQueueCompletion()`, which
 * resolves either way, so it reads `getBatchFailure()`. Whether that read sees
 * anything depends on ordering inside `processQueue`'s catch, exercised here
 * with the real objects rather than a mock.
 */
describe("Checkpoint drain failure (composed)", () => {
  let terminationManager: TerminationManager;
  let context: ExecutionContext;
  let logger: DurableLogger;
  let emitter: EventEmitter;
  let checkpointManager: CheckpointManager;

  const transportError = new DurableExecutionClientError(
    "backend unavailable",
    {
      scope: DurableExecutionClientErrorScope.INVOCATION,
    },
  );

  const enqueueTerminalCheckpoint = (stepId: string): void => {
    // Not awaited, mirroring how run-in-child-context-handler enqueues its
    // terminal checkpoint: the value is handed back to the handler while this
    // checkpoint is still queued.
    void checkpointManager.checkpoint(stepId, {
      Id: stepId,
      Action: OperationAction.SUCCEED,
      SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
      Type: OperationType.CONTEXT,
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    emitter = new EventEmitter();

    terminationManager = new TerminationManager();

    context = createMockExecutionContext({
      durableExecutionArn: "test-durable-execution-arn",
      durableExecutionClient: {
        checkpoint: jest.fn().mockRejectedValue(transportError),
      } as unknown as ExecutionContext["durableExecutionClient"],
      terminationManager,
    });

    logger = createDefaultLogger(context);
    checkpointManager = createTestCheckpointManager(
      context,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      emitter,
      logger,
    );
  });

  it("reports nothing when no batch has failed", () => {
    expect(checkpointManager.getBatchFailure()).toBeUndefined();
  });

  it("has recorded the classified failure by the time the drain's await resumes", async () => {
    enqueueTerminalCheckpoint("child-context-1");

    // The waiter is resolved rather than rejected, so awaiting it looks like an
    // ordinary completion; getBatchFailure() is what distinguishes the two.
    await expect(
      checkpointManager.waitForQueueCompletion(),
    ).resolves.toBeUndefined();

    const failure = checkpointManager.getBatchFailure();

    expect(failure).toBeInstanceOf(CheckpointUnrecoverableInvocationError);
    expect(failure?.message).toContain("backend unavailable");
  });

  it("reports the batch failure even when something else terminated first", async () => {
    // Why the failure is recorded on the CheckpointManager rather than read back
    // from the TerminationManager: terminate() early-returns once isTerminated is
    // set, so an earlier termination like this one would hide the
    // CHECKPOINT_FAILED that follows.
    //
    // The termination is raised directly to isolate that semantics. A real
    // suspend-class termination could not coexist with a batch still to drain:
    // executeTermination gates on shouldTerminate(), which requires an idle
    // queue.
    terminationManager.terminate({
      reason: TerminationReason.WAIT_SCHEDULED,
      message: "Wait scheduled",
    });

    enqueueTerminalCheckpoint("child-context-1");
    await checkpointManager.waitForQueueCompletion();

    expect(checkpointManager.getBatchFailure()).toBeInstanceOf(
      CheckpointUnrecoverableInvocationError,
    );
  });
});
