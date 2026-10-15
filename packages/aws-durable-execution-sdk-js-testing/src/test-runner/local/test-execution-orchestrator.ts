import { ExecutionStatus } from "@aws-sdk/client-lambda";
import {
  Operation,
  OperationStatus,
  InvocationStatus,
  DurableLambdaHandler,
  OperationAction,
  OperationType,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";
import { InvocationResult } from "../../checkpoint-server/storage/execution-manager";
import { ExecutionId } from "../../checkpoint-server/utils/tagged-strings";
import { InvokeHandler } from "./invoke-handler";
import { LocalOperationStorage } from "./operations/local-operation-storage";
import { InvocationTracker } from "./operations/invocation-tracker";
import {
  TestExecutionResult,
  TestExecutionState,
} from "../common/test-execution-state";
import { InvokeRequest } from "../types/durable-test-runner";
import { CheckpointOperation } from "../../checkpoint-server/storage/checkpoint-manager";
import { Scheduler } from "./orchestration/scheduler";
import { FunctionStorage } from "./operations/function-storage";
import { defaultLogger } from "../../logger";
import { Clock } from "@sinonjs/fake-timers";
import { QueueScheduler } from "./orchestration/queue-scheduler";
import { TimerScheduler } from "./orchestration/timer-scheduler";
import { CheckpointApiClient } from "./api-client/checkpoint-api-client";
import { realSetTimeout } from "./real-timers/real-timers";

/**
 * How long a failed execution waits before {@link TestExecutionOrchestrator.executeHandler}
 * rejects. A successful execution does not wait.
 */
const FAILED_EXECUTION_SETTLE_DELAY_MS = 100;

export interface SkipTimeProps {
  enabled: boolean;
  fakeClock?: Clock;
}

/**
 * Orchestrates test execution lifecycle, polling, and handler invocation for LocalDurableTestRunner.
 * Manages the coordination between checkpoint polling, operation processing, and handler execution.
 */
// Statuses from which an execution cannot move on. Used to tell an expected
// update-less notification for a finished execution apart from a real gap.
const TERMINAL_EXECUTION_STATUSES: ReadonlySet<OperationStatus> = new Set([
  OperationStatus.SUCCEEDED,
  OperationStatus.FAILED,
  OperationStatus.STOPPED,
  OperationStatus.TIMED_OUT,
]);

export class TestExecutionOrchestrator {
  private executionState: TestExecutionState;
  private invokeHandlerInstance: InvokeHandler;
  private invocationTracker: InvocationTracker;
  private readonly scheduler: Scheduler;
  private readonly pendingOperations = new Set<string>();

  // Pausing. The checkpoint server's half is to answer checkpoints without a token, which
  // suspends the invocation running at the time; this half is to start no invocation while
  // paused and to start the one that was held back once resumed. See pause().
  private paused = false;
  /**
   * The invocation held back while paused, started by resume(). Carries the parameters of
   * the initial invocation if that was the one held back, since it cannot be recreated.
   */
  private deferredInvocation:
    | { params?: Omit<InvocationResult, "executionId"> }
    | undefined;
  /** In-flight pause(), which resume() waits for so the two cannot interleave. */
  private pausing: Promise<void> = Promise.resolve();
  private runningInvocations = 0;
  private idleWaiters: (() => void)[] = [];
  private settled = false;
  private resolveExecutionId!: (executionId: ExecutionId) => void;
  private rejectExecutionId!: (err: unknown) => void;
  private readonly executionId: Promise<ExecutionId> = new Promise(
    (resolve, reject) => {
      this.resolveExecutionId = resolve;
      this.rejectExecutionId = reject;
    },
  );

  constructor(
    private handlerFunction: DurableLambdaHandler,
    private operationStorage: LocalOperationStorage,
    private readonly checkpointApi: CheckpointApiClient,
    private readonly functionStorage: FunctionStorage,
    private skipTimeProps: SkipTimeProps,
  ) {
    this.executionState = new TestExecutionState();
    this.invocationTracker = new InvocationTracker(checkpointApi);
    this.invokeHandlerInstance = new InvokeHandler();
    this.scheduler = this.skipTimeProps.enabled
      ? new QueueScheduler()
      : new TimerScheduler();
    // Only pause() and resume() await this, and neither need be called: without a handler a
    // failed start would surface as an unhandled rejection besides the error run() reports.
    this.executionId.catch(() => undefined);
  }

  /**
   * Pauses the execution, resolving once no invocation is running.
   *
   * The invocation running now, if any, is answered without a checkpoint token on its next
   * checkpoint. That checkpoint is accepted, the SDK abandons whatever it had not yet sent,
   * and the invocation returns PENDING. No invocation starts again until {@link resume}.
   * Waits keep elapsing and callbacks can still be completed while paused; the invocations
   * they would start are held back instead.
   *
   * Idempotent. Resolves at once if the execution has already finished.
   */
  pause(): Promise<void> {
    this.pausing = this.pausing.then(async () => {
      const executionId = await this.executionId;
      if (this.settled) {
        return;
      }

      if (!this.paused) {
        // Set before telling the server, so that no invocation can start in between.
        this.paused = true;
        await this.checkpointApi.pauseExecution(executionId);
      }

      await this.waitUntilIdle();
    });
    return this.pausing;
  }

  /**
   * Resumes a paused execution, starting the invocation that was held back, if any.
   *
   * Idempotent. Waits for an in-flight {@link pause} to finish first.
   */
  async resume(): Promise<void> {
    await this.pausing;
    const executionId = await this.executionId;
    if (!this.paused) {
      return;
    }

    // The server first, then the flag: an invocation starting in between would otherwise be
    // answered without a token again, and its PENDING judged as if nothing were paused.
    // Until the flag clears, anything starting is still held back and so still started below.
    await this.checkpointApi.resumeExecution(executionId);
    this.paused = false;

    const deferred = this.deferredInvocation;
    this.deferredInvocation = undefined;
    if (deferred && !this.settled) {
      this.scheduler.scheduleFunction(
        () => this.invokeHandler(executionId, deferred.params),
        (err) => {
          this.executionState.rejectWith(err);
        },
      );
    }
  }

  private waitUntilIdle(): Promise<void> {
    if (this.runningInvocations === 0 || this.settled) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private notifyIdle(): void {
    const waiters = this.idleWaiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }

  private async handleCompletedExecution(
    executionId: ExecutionId,
    operationId: string,
  ) {
    try {
      const result = await this.executionState.createExecutionPromise();

      if (result.status === ExecutionStatus.RUNNING) {
        throw new Error(
          `Execution did not resolve with valid status. Status: ${result.status}`,
        );
      }

      await this.checkpointApi.updateCheckpointData({
        executionId,
        operationId,
        operationData: {
          Status: result.status,
        },
        error: result.error,
        payload: result.result,
      });

      return result;
    } catch (err) {
      await this.checkpointApi.updateCheckpointData({
        executionId,
        operationId,
        operationData: {
          Status: OperationStatus.FAILED,
        },
        error: {
          ErrorMessage: err instanceof Error ? err.message : "Internal failure",
        },
      });
      throw err;
    } finally {
      this.scheduler.flushTimers();
    }
  }

  /**
   * Executes the durable function handler and returns the result.
   * The method will not resolve until the handler function completes successfully
   * or throws an error.
   *
   * @param params Optional parameters for the execution
   * @returns Promise that resolves with the execution result
   */
  async executeHandler(params?: InvokeRequest): Promise<TestExecutionResult> {
    // Reset invocations tracking when starting a new execution
    this.invocationTracker.reset();

    // Polling stops in two steps. Stopping tells the loop to send no further poll. Aborting
    // also cancels a poll that is in flight, if the client supports that. See the finally
    // block for why the two happen at different times.
    const stopPollingController = new AbortController();
    const abortController = new AbortController();
    // Set once polling starts, so the end of the execution knows there is polling to stop.
    let polledExecutionId: ExecutionId | undefined;
    let failed = false;

    try {
      const invocationId = this.invocationTracker.createInvocation();

      const {
        executionId,
        operationEvents: initialOperationsEvents,
        checkpointToken,
      }: InvocationResult = await this.checkpointApi.startDurableExecution({
        payload: JSON.stringify(params?.payload),
        invocationId,
      });
      this.resolveExecutionId(executionId);

      const executionOperationId = initialOperationsEvents
        .at(0)
        ?.events.at(0)?.Id;

      if (!executionOperationId) {
        throw new Error("Could not get Id for EXECUTION operation");
      }

      // Start polling for checkpoint data before invoking the handler
      polledExecutionId = executionId;
      void this.pollForCheckpointData(
        abortController,
        executionId,
        stopPollingController.signal,
      );

      this.operationStorage.populateOperations(initialOperationsEvents);

      // Start initial invocation of the handler inside scheduler
      this.scheduler.scheduleFunction(
        () =>
          this.invokeHandler(executionId, {
            operationEvents: initialOperationsEvents,
            checkpointToken,
            invocationId,
            updatedOperationIds: [],
          }),
        (err) => {
          this.executionState.rejectWith(err);
        },
      );

      return await this.handleCompletedExecution(
        executionId,
        executionOperationId,
      );
    } catch (err) {
      failed = true;
      // A no-op once the id has resolved. Before that, it is what stops a pause() waiting
      // on an execution that never started.
      this.rejectExecutionId(err);
      throw err;
    } finally {
      // Nothing left to pause, so release anyone waiting for the execution to go quiet.
      this.settled = true;
      this.notifyIdle();

      if (failed) {
        // The failure path keeps the fixed delay it always had before rejecting. A
        // rejection means the handler crashed or the runner reached an invalid state, so
        // it is rare and the delay costs little. Callers that start an execution and
        // attach a rejection handler later, for example after advancing fake timers, rely
        // on it: a promise that rejects before it has a handler fails the Jest test.
        await new Promise<void>((resolve) => {
          realSetTimeout(resolve, FAILED_EXECUTION_SETTLE_DELAY_MS);
        });
      }

      // Stop polling, but do not abort yet. A poll can be in flight with the last updates:
      // the checkpoint server has already taken them from its queue to answer it. If an
      // abort cancelled that poll, its updates would be lost, because the drain only returns
      // what is still queued. The drain is answered after that poll, so aborting once the
      // drain is answered cancels nothing that carries updates.
      stopPollingController.abort();

      let drainRequestError: unknown;
      if (polledExecutionId !== undefined) {
        try {
          await this.drainCheckpointData(polledExecutionId);
        } catch (err) {
          drainRequestError = err;
        }
      }

      abortController.abort();

      // Settle from a timer callback, as the fixed wait always did. Code after the
      // execution then starts in the same event loop phase as before, which matters to
      // callers that race a 0 ms timer against setImmediate. A 0 ms timer costs about 1 ms.
      await new Promise<void>((resolve) => {
        realSetTimeout(resolve, 0);
      });

      // Never hide the error the execution itself failed with. Otherwise a failed drain
      // request must surface, since its updates never reached this process.
      if (drainRequestError !== undefined) {
        if (failed) {
          defaultLogger.warn(
            "Could not collect the last checkpoint updates of a failed execution:",
            drainRequestError,
          );
        } else {
          // biome-ignore lint/correctness/noUnsafeFinally: a failed drain request leaves the result without its last updates, so it must surface when nothing else has failed.
          throw drainRequestError;
        }
      }
    }
  }

  /**
   * Collects the checkpoint updates the polling loop has not delivered, once the execution
   * has finished.
   *
   * Replaces a fixed wait for the long poll. The final updates are written by
   * {@link handleCompletedExecution}, and the checkpoint server answers that write before
   * the poll that carries them, so they can still be on their way when the execution ends.
   * The worker handles UpdateCheckpointData, PollCheckpointData and DrainCheckpointData in
   * request order. So every poll that took updates is answered before the later drain.
   * The final EXECUTION update also marks the execution complete. So a delayed checkpoint
   * request cannot add an update after the drain. The drain therefore holds what remains,
   * and it releases a poll still waiting with no updates.
   */
  private async drainCheckpointData(executionId: ExecutionId): Promise<void> {
    const { operations } =
      await this.checkpointApi.drainCheckpointData(executionId);
    try {
      this.applyCheckpointOperations(operations, executionId);
    } catch (err) {
      // A processing error from the poll loop is sent to this state too. The state has
      // already settled, so this preserves that behaviour whichever path got the update.
      this.executionState.rejectWith(err);
    }
  }

  /**
   * Stores a batch of checkpoint updates and acts on them.
   */
  private applyCheckpointOperations(
    operations: CheckpointOperation[],
    executionId: ExecutionId,
  ): void {
    defaultLogger.debug(
      `Processing ${operations.length} operations`,
      operations,
    );

    this.operationStorage.populateOperations(operations);

    this.processOperations(operations, executionId);
  }

  /**
   * Continuously polls checkpoint data until execution reaches completion.
   *
   * This method runs in a loop, repeatedly checking for new operations
   * and processing them. The loop sends no further poll once polling is
   * stopped or aborted.
   *
   * @param abortController Aborted when execution completes, after the final drain
   * @param executionId The execution to monitor
   * @param stopSignal Aborted when execution completes, before the final drain
   */
  private async pollForCheckpointData(
    abortController: AbortController,
    executionId: ExecutionId,
    stopSignal?: AbortSignal,
  ): Promise<void> {
    try {
      while (!abortController.signal.aborted && !stopSignal?.aborted) {
        const { operations } = await this.checkpointApi.pollCheckpointData(
          executionId,
          abortController.signal,
        );

        this.applyCheckpointOperations(operations, executionId);

        // Yield to event loop if `pollCheckpointData` returns too often (mainly in unit tests).
        await new Promise((resolve) => setImmediate(resolve));
      }
    } catch (err: unknown) {
      // Only reject execution when the error is not an abort error
      if (
        !(
          err &&
          typeof err === "object" &&
          "name" in err &&
          err.name === "AbortError"
        )
      ) {
        this.executionState.rejectWith(err);
      }
    }
  }

  /**
   * Processes a batch of operations from checkpoint polling.
   *
   * @param operations Array of operations with their updates to process
   * @param executionId The current execution ID
   */
  private processOperations(
    operations: CheckpointOperation[],
    executionId: ExecutionId,
  ): void {
    for (const { update, operation } of operations) {
      if (!operation.Id) {
        throw new Error("Could not process operation without an Id");
      }

      this.processOperation(update, operation, executionId);
    }
  }

  /**
   * Processes a single operation based on its type.
   *
   * @param update The operation update containing processing instructions
   * @param operation The operation being processed
   * @param executionId The current execution ID
   */
  private processOperation(
    update: OperationUpdate | undefined,
    operation: Operation,
    executionId: ExecutionId,
  ): void {
    if (!operation.Id) {
      throw new Error("Could not process operation without an Id");
    }

    switch (operation.Type) {
      case OperationType.WAIT:
        this.handleWaitUpdate(update, operation, executionId);
        break;
      case OperationType.STEP:
        this.handleStepUpdate(update, operation, executionId);
        break;
      case OperationType.CALLBACK:
        this.handleCallbackUpdate(operation, executionId);
        break;
      case OperationType.EXECUTION:
        this.handleExecutionUpdate(update, operation);
        break;
      case OperationType.CHAINED_INVOKE:
        this.handleInvokeUpdate(update, executionId).catch((err: unknown) => {
          this.executionState.rejectWith(err);
        });
        break;
    }
  }

  private async handleInvokeUpdate(
    update: OperationUpdate | undefined,
    executionId: ExecutionId,
  ) {
    if (update?.Action !== OperationAction.START) {
      return;
    }

    const functionName = update.ChainedInvokeOptions?.FunctionName;
    // TODO: invoke nested execution with timeout
    // const timeoutSeconds = update?.ChainedInvokeOptions?.TimeoutSeconds

    if (!functionName) {
      throw new Error(
        `FunctionName is required for ${OperationType.CHAINED_INVOKE} updates`,
      );
    }

    const operationId = update.Id;
    if (operationId === undefined) {
      throw new Error("Missing operation id");
    }

    this.pendingOperations.add(operationId);

    const { result, error } = await this.functionStorage.runHandler(
      functionName,
      update.Payload,
    );

    await this.checkpointApi.updateCheckpointData({
      executionId,
      operationId: operationId,
      operationData: {
        // todo: handle other operation types as well
        Status: result ? OperationStatus.SUCCEEDED : OperationStatus.FAILED,
        ChainedInvokeDetails: {
          Result: result,
          Error: error,
        },
      },
    });

    this.scheduler.scheduleFunction(
      () => this.invokeHandler(executionId),
      (err) => {
        this.executionState.rejectWith(err);
      },
      undefined,
      () => {
        this.pendingOperations.delete(operationId);
        return Promise.resolve();
      },
    );
  }

  /**
   * Processes a WAIT operation by scheduling the next invocation after the specified delay.
   *
   * The delay duration depends on the skipTime setting:
   * - If skipTime is false: uses the actual wait time specified in waitSeconds
   * - If skipTime is true: uses a minimal delay (1ms) for faster execution
   *
   * @param update The WAIT operation update containing timing information
   * @param operation The operation being processed
   * @param executionId The current execution ID
   */
  private handleWaitUpdate(
    update: OperationUpdate | undefined,
    operation: Operation,
    executionId: ExecutionId,
  ): void {
    if (update?.Action !== OperationAction.START) {
      return;
    }

    const waitEndTimestamp = operation.WaitDetails?.ScheduledEndTimestamp;

    if (!waitEndTimestamp) {
      throw new Error("Wait operation is missing ScheduledEndTimestamp");
    }

    const operationId = operation.Id;

    if (!operationId) {
      throw new Error("Missing operation id");
    }

    defaultLogger.debug(`Queuing wait for ${waitEndTimestamp.toISOString()}`, {
      executionId,
      operation,
      update,
    });
    this.scheduleInvocationAtTimestamp(waitEndTimestamp, executionId, () => {
      defaultLogger.debug(
        `Wait triggered at ${waitEndTimestamp.toISOString()}`,
        {
          executionId,
          operation,
          update,
        },
      );
      return this.checkpointApi.updateCheckpointData({
        executionId,
        operationId,
        operationData: {
          Status: OperationStatus.SUCCEEDED,
        },
      });
    });
  }

  /**
   * Processes a STEP operation, handling retries if needed.
   * Step operations only update checkpoint data and do not re-invoke the handler.
   *
   * @param update The STEP operation update
   * @param operation The operation being processed
   * @param executionId The current execution ID
   */
  private handleStepUpdate(
    update: OperationUpdate | undefined,
    operation: Operation,
    executionId: ExecutionId,
  ): void {
    if (update?.Action === OperationAction.RETRY) {
      const nextAttemptTimestamp = operation.StepDetails?.NextAttemptTimestamp;

      if (!nextAttemptTimestamp) {
        throw new Error(
          "Step operation with retry is missing NextAttemptTimestamp",
        );
      }

      const operationId = operation.Id;

      if (!operationId) {
        throw new Error("Step operation is missing operation id");
      }

      defaultLogger.debug(
        `Queuing step retry to start at ${nextAttemptTimestamp.toISOString()}`,
        {
          executionId,
          operation,
          update,
        },
      );
      this.scheduleInvocationAtTimestamp(
        nextAttemptTimestamp,
        executionId,
        async () => {
          defaultLogger.debug(
            `Retry triggered at ${nextAttemptTimestamp.toISOString()}s`,
            {
              executionId,
              operation,
              update,
            },
          );
          await this.checkpointApi.updateCheckpointData({
            executionId,
            operationId,
            operationData: {
              Status: OperationStatus.READY,
            },
          });
        },
      );
    }
  }

  private handleCallbackUpdate(
    operation: Operation,
    executionId: ExecutionId,
  ): void {
    const operationId = operation.Id;
    if (!operationId) {
      throw new Error("Missing operation id");
    }

    if (operation.Status === OperationStatus.STARTED) {
      this.pendingOperations.add(operationId);
      return;
    }

    this.scheduler.scheduleFunction(
      () => this.invokeHandler(executionId),
      (err) => {
        this.executionState.rejectWith(err);
      },
      undefined,
      () => {
        this.pendingOperations.delete(operationId);
        return Promise.resolve();
      },
    );
  }

  private handleExecutionUpdate(
    update: OperationUpdate | undefined,
    operation: Operation,
  ): void {
    if (!update) {
      // An already-terminal execution is re-published without an update when the
      // checkpoint server ignores the invocation response. That happens on the
      // oversized-result path, where a checkpoint completes the execution before
      // the handler returns, so this notification carries nothing to resolve.
      // Keep the error for the genuinely unexpected case: a missing update on an
      // execution that has not reached a terminal state.
      if (
        operation.Status &&
        TERMINAL_EXECUTION_STATUSES.has(operation.Status)
      ) {
        defaultLogger.debug(
          "Ignoring update-less notification for a terminal execution",
          { status: operation.Status },
        );
        return;
      }

      throw new Error("Operation update is missing for execution update");
    }

    if (!operation.Status) {
      throw new Error("Could not find status in execution operation");
    }

    defaultLogger.debug("Resolving execution", {
      update,
    });
    this.executionState.resolveWith({
      result: update.Payload,
      error: update.Error,
      status:
        update.Action === OperationAction.SUCCEED
          ? ExecutionStatus.SUCCEEDED
          : ExecutionStatus.FAILED,
    });
  }

  /**
   * Schedules an invocation to execute at a specific timestamp.
   *
   * @param timestamp The time that the next invocation should start
   * @param executionId The id of the execution
   * @param updateCheckpoint Function that always executes before the next invocation (e.g., for checkpoint updates)
   */
  private scheduleInvocationAtTimestamp(
    timestamp: Date,
    executionId: ExecutionId,
    updateCheckpoint: () => Promise<void>,
  ): void {
    this.scheduler.scheduleFunction(
      () => this.invokeHandler(executionId),
      (err) => {
        this.executionState.rejectWith(err);
      },
      timestamp,
      () =>
        updateCheckpoint().then(() => {
          if (!this.skipTimeProps.enabled) {
            return;
          }

          const fakeClock = this.skipTimeProps.fakeClock;
          if (!fakeClock) {
            defaultLogger.debug(
              "Skipped advancing fake timers since timers were not initialized",
            );
            return;
          }

          // When skipTime is enabled, we are advancing the timers in the language SDK waitBeforeContinue timers.
          const timerCount = fakeClock.countTimers();
          const advanceTimersMs = timestamp.getTime() - Date.now();
          if (timerCount > 0 && advanceTimersMs > 0) {
            defaultLogger.debug(
              `Advancing fake timers for ${timerCount} timers by ${advanceTimersMs}ms`,
            );
            fakeClock.tick(advanceTimersMs);
            return;
          }

          defaultLogger.debug(
            `Skipped advancing fake timers with timerCount=(${timerCount}) and advanceTimerMs=${advanceTimersMs}`,
          );
        }),
    );
  }

  /**
   * Invokes the handler and determines if execution should continue.
   *
   * When the handler returns "SUCCEEDED/FAILED" status, the execution is resolved
   * and polling stops. For "PENDING" status, execution continues.
   *
   * While paused, the invocation is held back rather than started, and resume() starts it.
   *
   * @param executionId Current execution ID
   * @param invocationParams Data for the invocation if an invocation was already created.
   * If not provided, a new invocation will be created.
   */
  private async invokeHandler(
    executionId: ExecutionId,
    invocationParams?: Omit<InvocationResult, "executionId">,
  ): Promise<void> {
    if (this.paused) {
      defaultLogger.debug("Holding back invocation while execution is paused");
      // One held-back invocation stands for any number: each would replay the same state.
      // The initial invocation's parameters are kept if they were the ones held back.
      this.deferredInvocation = {
        params: invocationParams ?? this.deferredInvocation?.params,
      };
      return;
    }

    this.runningInvocations++;
    try {
      await this.runInvocation(executionId, invocationParams);
    } finally {
      this.runningInvocations--;
      if (this.runningInvocations === 0) {
        this.notifyIdle();
      }
    }
  }

  private async runInvocation(
    executionId: ExecutionId,
    invocationParams?: Omit<InvocationResult, "executionId">,
  ): Promise<void> {
    if (!invocationParams && this.invocationTracker.hasActiveInvocation()) {
      if (this.skipTimeProps.enabled) {
        throw new Error(
          "Cannot schedule concurrent invocation when skip time is enabled",
        );
      }
      defaultLogger.debug(
        "Skipping scheduled function execution due to current active invocation",
      );
      return;
    }

    const invocationId =
      invocationParams?.invocationId ??
      this.invocationTracker.createInvocation();

    const { checkpointToken, operationEvents, updatedOperationIds } =
      invocationParams ??
      (await this.checkpointApi.startInvocation({
        executionId,
        invocationId,
      }));

    const operations = operationEvents.map((operation) => operation.operation);

    try {
      defaultLogger.debug(`Invoking handler with invocationId=${invocationId}`);

      const value = await this.invokeHandlerInstance.invoke(
        this.handlerFunction,
        {
          durableExecutionArn: executionId,
          checkpointToken: checkpointToken,
          operations,
          updatedOperationIds,
        },
      );

      defaultLogger.debug(
        `Handler response for invocationId=${invocationId}:`,
        value,
      );

      const { event, hasDirtyOperations } =
        await this.invocationTracker.completeInvocation(
          executionId,
          invocationId,
          "Error" in value ? value.Error : undefined,
        );

      this.operationStorage.addHistoryEvent(event);

      if (value.Status === InvocationStatus.SUCCEEDED) {
        this.executionState.resolveWith({
          result: value.Result,
          status: OperationStatus.SUCCEEDED,
        });
        return;
      }

      if (value.Status === InvocationStatus.FAILED) {
        this.executionState.resolveWith({
          error: value.Error,
          status: OperationStatus.FAILED,
        });
        return;
      }

      // A PENDING while paused leaves resume() an invocation to start, whatever else is
      // pending. The checks below cannot decide it: they ask whether the scheduler still has
      // work, and the queue scheduler used with skipTime counts the invocation now ending as
      // work, so they would conclude something else will continue the execution when nothing
      // will. At worst this costs one extra invocation after resume, which replays and returns
      // PENDING again if nothing is ready.
      if (this.paused) {
        this.deferredInvocation ??= {};
        return;
      }

      if (!this.scheduler.hasScheduledFunction() && hasDirtyOperations) {
        defaultLogger.debug(
          "Re-invoking handler since invocation completed with pending dirty operations",
        );
        // Re-invoke the handler if its last checkpoint was not synchronized
        // with the backend and there are pending dirty operations when the
        // invocation completed.
        this.scheduler.scheduleFunction(
          () => this.invokeHandler(executionId),
          (err) => {
            this.executionState.rejectWith(err);
          },
        );
        return;
      }

      if (
        !this.scheduler.hasScheduledFunction() &&
        !this.pendingOperations.size
      ) {
        this.executionState.rejectWith({
          error: {
            ErrorType: "InvalidParameterValueException",
            ErrorMessage:
              "Cannot return PENDING status with no pending operations.",
          },
          status: ExecutionStatus.FAILED,
        });
      }
    } catch (err) {
      defaultLogger.debug(
        `Handler failed for invocationId=${invocationId}:`,
        err,
      );

      const { event } = await this.invocationTracker.completeInvocation(
        executionId,
        invocationId,
        {
          ErrorMessage: err instanceof Error ? err.message : undefined,
          ErrorType: err instanceof Error ? err.name : undefined,
          StackTrace: err instanceof Error ? err.stack?.split("\n") : undefined,
        },
      );

      this.operationStorage.addHistoryEvent(event);
      this.executionState.rejectWith(err);
    }
  }
}
