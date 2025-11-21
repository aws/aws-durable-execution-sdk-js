import { defaultLogger } from "../../../logger";
import { Scheduler } from "./scheduler";

/**
 * Queue-based scheduler implementation that executes functions sequentially in FIFO order.
 *
 * This scheduler ignores timing constraints and processes all functions in the order they were
 * scheduled, ensuring deterministic execution by preventing concurrent invocations. Functions
 * are processed one at a time, with each function completing before the next begins.
 *
 * The QueueScheduler is used only in the case of time-skipping, where it can be assumed that
 * all invocations should be starting immediately, or as close as possible to immediately. Sometimes
 * multiple invocations can be scheduled, so this scheduler will queue them up to execute as soon
 * as possible instead of scheduling them for later execution.
 *
 * **Trade-offs:**
 * - ✅ Deterministic execution order
 * - ✅ Prevents concurrency issues in test environments
 * - ❌ No concurrent execution (less realistic than actual service behavior)
 * - ❌ Timing constraints are completely ignored
 *
 * **Key behaviors:**
 * - UpdateCheckpoint errors are reported immediately, even for flushed items
 * - Functions execute sequentially regardless of their scheduled timestamps
 */
export class QueueScheduler implements Scheduler {
  private readonly functionQueue: {
    updateCheckpointPromise: Promise<[PromiseSettledResult<void>]>;
    startInvocation: () => Promise<void>;
    onError: (err: unknown) => void;
  }[] = [];
  private isProcessing = false;
  private processingPromise: Promise<void> = Promise.resolve();

  /**
   * Schedules a function to be executed sequentially in the queue.
   *
   * Functions are processed in FIFO order regardless of the timestamp parameter.
   * UpdateCheckpoint is executed immediately upon scheduling (not during processing)
   * to ensure critical checkpoint data is updated promptly. If updateCheckpoint fails,
   * onError is called immediately and the startInvocation will be skipped during processing.
   *
   * @param startInvocation - The function to execute when processed from the queue
   * @param onError - Error handler called immediately for updateCheckpoint errors, or during processing for startInvocation errors
   * @param _timestamp - Ignored by this scheduler (functions execute in queue order)
   * @param updateCheckpoint - Optional checkpoint update function executed immediately upon scheduling
   */
  scheduleFunction(
    startInvocation: () => Promise<void>,
    onError: (err: unknown) => void,
    _timestamp?: Date, // Ignored since this scheduler is queue based
    updateCheckpoint?: () => Promise<void>,
  ): void {
    // Checkpoint is updated immediately since language SDK may not complete
    // invocation until the correct status is updated.
    const updateCheckpointPromise = Promise.allSettled([
      updateCheckpoint
        ? updateCheckpoint().catch((err: unknown) => {
            onError(err);
            throw err;
          })
        : Promise.resolve(),
    ]);

    // Queue the function for sequential execution
    this.functionQueue.push({
      updateCheckpointPromise,
      startInvocation,
      onError,
    });

    // Start processing if not already running
    if (!this.isProcessing) {
      // Use setImmediate to yield to event loop before starting processing
      const processingPromise = new Promise<void>((resolve) => {
        setImmediate(() => {
          void this.processQueue().finally(() => {
            resolve();
          });
        });
      });

      this.processingPromise = this.processingPromise.then(
        () => processingPromise,
      );
    }
  }

  /**
   * Processes all queued functions sequentially.
   *
   * This method runs continuously until the queue is empty, processing one function
   * at a time. If updateCheckpoint failed during scheduling, the corresponding
   * startInvocation is skipped. Yields to the event loop between each function
   * to allow for queue flushing and other async operations.
   *
   * @private
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.functionQueue.length > 0) {
        const item = this.functionQueue.shift();
        if (!item) {
          break;
        }
        const { startInvocation, updateCheckpointPromise, onError } = item;
        try {
          defaultLogger.debug("Running next function in scheduler queue");
          const updateResult = await updateCheckpointPromise;
          if (updateResult[0].status === "rejected") {
            defaultLogger.debug(
              "Error updating checkpoint data, skipping invocation",
            );
            continue;
          }
          await startInvocation();
          defaultLogger.debug("Scheduled function completed successfully");
        } catch (err) {
          defaultLogger.debug("Scheduled function failed", err);
          onError(err);
        }

        // Yield to event loop before processing next function since this queue
        // is behaving like a scheduler, so timers could be flushed before the next iteration
        await new Promise((resolve) => setImmediate(resolve));
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Returns a promise that resolves when all currently queued and processing functions complete.
   *
   * This method is useful for testing to await the completion of all scheduled work
   * without needing to poll the scheduler state.
   *
   * @returns A promise that resolves when the processing queue is empty and no functions are executing
   */
  waitForCompletion(): Promise<void> {
    return this.processingPromise;
  }

  /**
   * Immediately clears the function queue and stops processing.
   *
   * Any functions currently queued (but not yet processing) will be removed without execution.
   * If a function is currently executing, it will complete, but subsequent queued functions
   * will not execute.
   *
   * @remarks
   * UpdateCheckpoint errors may still be reported via onError for functions that were
   * scheduled but not yet processed, as updateCheckpoint is executed immediately upon scheduling.
   */
  flushTimers(): void {
    defaultLogger.debug(
      `Flushing ${this.functionQueue.length} queued functions`,
    );
    this.functionQueue.length = 0;
    this.isProcessing = false;
  }

  /**
   * Checks whether there are any functions queued or currently being processed.
   *
   * @returns true if there are queued functions or if the queue processor is currently running, false otherwise
   */
  hasScheduledFunction(): boolean {
    return this.functionQueue.length > 0 || this.isProcessing;
  }
}
