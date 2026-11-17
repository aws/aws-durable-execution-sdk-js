import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";
import { createStepHandler } from "./step-handler";
import {
  type ExecutionContext,
  type StepConfig,
  StepSemantics,
  OperationLifecycleState,
} from "../../types";
import { OperationStatus, type Operation } from "../../types/wire";
import type { Context } from "aws-lambda";
import type { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { TerminationReason } from "../../termination-manager/types";
import type { DurableLogger } from "../../types/durable-logger";

const STEP_ID = "step-1";
const HASHED_ID = hashId(STEP_ID);

describe("Step Handler pauseEvery", () => {
  let stepData: Operation;
  let pauseExecution: Mock;
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let logger: DurableLogger;

  // Sets the attempts already made before this invocation. The next attempt is one more.
  const givenPriorAttempts = (attempts: number, status?: OperationStatus) => {
    stepData = {
      Id: HASHED_ID,
      Status: status,
      StepDetails: { Attempt: attempts },
    } as Operation;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    givenPriorAttempts(0);

    pauseExecution = vi.fn().mockResolvedValue(undefined);

    mockContext = {
      getStepData: vi.fn(() => stepData),
      _stepData: {},
      durableExecutionArn: "test-arn",
      durableExecutionClient: {
        getExecutionState: vi.fn(),
        checkpoint: vi.fn(),
        pauseExecution,
      },
      terminationManager: {
        terminate: vi.fn(),
        isTerminationRequested: vi.fn().mockReturnValue(false),
      },
    } as unknown as ExecutionContext;

    mockCheckpoint = {
      checkpoint: vi.fn().mockResolvedValue(undefined),
      markOperationState: vi.fn(),
      markOperationAwaited: vi.fn(),
      // Never resolves, so a normal retry stops here instead of running the next attempt.
      waitForRetryTimer: vi.fn(() => new Promise(() => {})),
    } as unknown as Checkpoint;

    logger = {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as DurableLogger;
  });

  const runFailingStep = (config: StepConfig<unknown>): Promise<unknown> => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      {} as Context,
      () => STEP_ID,
      logger,
    );
    const promise = stepHandler(
      "my-step",
      async () => {
        throw new Error("boom");
      },
      { retryStrategy: () => ({ shouldRetry: true }), ...config },
    );
    // Starts the step. A pause or a normal retry never settles the promise.
    promise.catch(() => {});
    return promise;
  };

  const waitForRetryOrPause = () =>
    vi.waitFor(() => {
      const retried = (mockCheckpoint.waitForRetryTimer as Mock).mock.calls
        .length;
      const terminated = (mockContext.terminationManager.terminate as Mock).mock
        .calls.length;
      expect(retried + terminated).toBeGreaterThan(0);
    });

  const actions = () =>
    (mockCheckpoint.checkpoint as Mock).mock.calls.map(
      ([, update]) => update.Action,
    );

  it("pauses after an attempt that is a multiple of pauseEvery", async () => {
    givenPriorAttempts(4);
    // The step must still be EXECUTING while the SDK awaits the pause call.
    pauseExecution.mockImplementation(async () => {
      expect(mockCheckpoint.markOperationState).not.toHaveBeenCalledWith(
        STEP_ID,
        OperationLifecycleState.RETRY_WAITING,
        expect.anything(),
      );
      expect(actions()).toEqual(["START", "RETRY"]);
    });

    void runFailingStep({ pauseEvery: 5 });
    await waitForRetryOrPause();

    expect(pauseExecution).toHaveBeenCalledWith({
      DurableExecutionArn: "test-arn",
      ClientToken: `${HASHED_ID}-5`,
      Reason: 'Step "my-step" failed attempt 5',
    });
    expect(actions()).toEqual(["START", "RETRY"]);
    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: TerminationReason.EXECUTION_PAUSED }),
    );
    expect(mockCheckpoint.waitForRetryTimer).not.toHaveBeenCalled();
  });

  it("asks to pause only after the RETRY checkpoint is accepted", async () => {
    givenPriorAttempts(4);
    let acceptRetry!: () => void;
    (mockCheckpoint.checkpoint as Mock).mockImplementation(
      async (_id: string, update: { Action: string }) => {
        if (update.Action === "RETRY") {
          await new Promise<void>((resolve) => {
            acceptRetry = resolve;
          });
        }
      },
    );

    void runFailingStep({ pauseEvery: 5 });
    await vi.waitFor(() => expect(acceptRetry).toBeDefined());
    // Gives a pause call that does not wait for RETRY the time to happen.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pauseExecution).not.toHaveBeenCalled();
    expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();

    acceptRetry();
    await waitForRetryOrPause();
    expect(pauseExecution).toHaveBeenCalledTimes(1);
    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: TerminationReason.EXECUTION_PAUSED }),
    );
  });

  it("does not ask to pause when the RETRY checkpoint never resolves", async () => {
    // The checkpoint manager leaves RETRY unresolved when the service answers it without
    // a token, or when it drops RETRY for a finished ancestor.
    givenPriorAttempts(4);
    (mockCheckpoint.checkpoint as Mock).mockImplementation(
      async (_id: string, update: { Action: string }) => {
        if (update.Action === "RETRY") {
          await new Promise(() => {});
        }
      },
    );

    void runFailingStep({ pauseEvery: 5 });
    await vi.waitFor(() => expect(actions()).toEqual(["START", "RETRY"]));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(pauseExecution).not.toHaveBeenCalled();
    expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();
    expect(mockCheckpoint.waitForRetryTimer).not.toHaveBeenCalled();
  });

  it("pauses again on later multiples of pauseEvery", async () => {
    givenPriorAttempts(9);

    void runFailingStep({ pauseEvery: 5 });
    await waitForRetryOrPause();

    expect(pauseExecution).toHaveBeenCalledWith(
      expect.objectContaining({ ClientToken: `${HASHED_ID}-10` }),
    );
    expect(mockContext.terminationManager.terminate).toHaveBeenCalled();
  });

  it("uses the same ClientToken when the same attempt runs again", async () => {
    givenPriorAttempts(4);
    void runFailingStep({ pauseEvery: 5 });
    await waitForRetryOrPause();

    vi.clearAllMocks();
    void runFailingStep({ pauseEvery: 5 });
    await waitForRetryOrPause();

    expect(pauseExecution).toHaveBeenCalledTimes(1);
    expect(pauseExecution.mock.calls[0][0].ClientToken).toBe(`${HASHED_ID}-5`);
  });

  it("does not pause on other attempts", async () => {
    givenPriorAttempts(3);

    void runFailingStep({ pauseEvery: 5 });
    await waitForRetryOrPause();

    expect(pauseExecution).not.toHaveBeenCalled();
    expect(actions()).toEqual(["START", "RETRY"]);
    expect(mockCheckpoint.waitForRetryTimer).toHaveBeenCalled();
    expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();
  });

  it("does not pause without pauseEvery", async () => {
    givenPriorAttempts(4);

    void runFailingStep({});
    await waitForRetryOrPause();

    expect(pauseExecution).not.toHaveBeenCalled();
    expect(mockCheckpoint.waitForRetryTimer).toHaveBeenCalled();
  });

  it("fails as usual when the retry strategy stops", async () => {
    givenPriorAttempts(4);

    await expect(
      runFailingStep({
        pauseEvery: 5,
        retryStrategy: () => ({ shouldRetry: false }),
      }),
    ).rejects.toThrow("boom");

    expect(pauseExecution).not.toHaveBeenCalled();
    expect(actions()).toEqual(["START", "FAIL"]);
    expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();
  });

  it("logs a warning with the error and retries as usual when the pause call fails", async () => {
    givenPriorAttempts(4);
    const error = Object.assign(new Error("User is not authorized"), {
      name: "AccessDeniedException",
    });
    pauseExecution.mockRejectedValue(error);

    void runFailingStep({ pauseEvery: 5 });
    await waitForRetryOrPause();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "failed attempt 5: AccessDeniedException: User is not authorized. The step retries as usual. One possible cause is that the execution role does not allow lambda:PauseDurableExecution. Another is an @aws-sdk/client-lambda older than 3.1171.0 in the bundle.",
      ),
      error,
    );
    expect(actions()).toEqual(["START", "RETRY"]);
    expect(mockCheckpoint.waitForRetryTimer).toHaveBeenCalled();
    expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();
  });

  it("does not blame permissions when the execution is already pausing or paused", async () => {
    givenPriorAttempts(4);
    const error = Object.assign(new Error("Execution is already paused"), {
      name: "ResourceConflictException",
    });
    pauseExecution.mockRejectedValue(error);

    void runFailingStep({ pauseEvery: 5 });
    await waitForRetryOrPause();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "ResourceConflictException: Execution is already paused. The step retries as usual. The execution is already pausing or paused.",
      ),
      error,
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("lambda:PauseDurableExecution"),
      error,
    );
    expect(actions()).toEqual(["START", "RETRY"]);
    expect(mockCheckpoint.waitForRetryTimer).toHaveBeenCalled();
  });

  it("retries as usual when the client has no pauseExecution method", async () => {
    givenPriorAttempts(4);
    delete (mockContext.durableExecutionClient as { pauseExecution?: unknown })
      .pauseExecution;

    void runFailingStep({ pauseEvery: 5 });
    await waitForRetryOrPause();

    expect(pauseExecution).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(actions()).toEqual(["START", "RETRY"]);
    expect(mockCheckpoint.waitForRetryTimer).toHaveBeenCalled();
    expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();
  });

  it("does not pause for an interrupted AtMostOncePerRetry step on replay", async () => {
    // The step function did not throw in this invocation. The previous invocation stopped
    // while the step was STARTED.
    givenPriorAttempts(4, OperationStatus.STARTED);

    void runFailingStep({
      pauseEvery: 5,
      semantics: StepSemantics.AtMostOncePerRetry,
    });
    await waitForRetryOrPause();

    expect(pauseExecution).not.toHaveBeenCalled();
    expect(actions()).toEqual(["RETRY"]);
    expect(mockCheckpoint.waitForRetryTimer).toHaveBeenCalled();
    expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();
  });
});
