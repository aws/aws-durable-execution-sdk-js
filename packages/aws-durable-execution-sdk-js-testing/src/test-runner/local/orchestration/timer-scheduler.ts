import { randomUUID } from "node:crypto";
import { defaultLogger } from "../../../logger";
import { Scheduler } from "./scheduler";

/**
 * Timer-based scheduler implementation that uses setTimeout for scheduling function execution.
 *
 * This scheduler respects timing constraints by scheduling functions to execute at specific
 * timestamps using Node.js timers. Checkpoint updates are executed concurrently if their timers
 * expire at the same time, which more closely mimics real-world service behavior where
 * multiple invocations can be scheduled to be fired at the same time, or while an invocation
 * is actively in progress.
 */
export class TimerScheduler implements Scheduler {
  private readonly runningTimers = new Set<NodeJS.Timeout>();

  /**
   * Schedules a function to be executed at a specific timestamp.
   *
   * If the timestamp is in the past, the function executes immediately (0ms delay).
   * If updateCheckpoint is provided, it will be executed before startInvocation.
   *
   * @param startInvocation - The function to execute after the delay
   * @param onError - Error handler called if startInvocation or updateCheckpoint fails
   * @param timestamp - When to execute the function (defaults to current time)
   * @param updateCheckpoint - Optional checkpoint update function executed before startInvocation
   */
  scheduleFunction(
    startInvocation: () => Promise<void>,
    onError: (err: unknown) => void,
    timestamp: Date = new Date(),
    updateCheckpoint?: () => Promise<void>,
  ): void {
    const delayMs = Math.max(0, timestamp.getTime() - Date.now());
    const id = randomUUID();
    defaultLogger.debug(
      `Scheduling function to run in ${delayMs}ms - Scheduler ID: ${id}`,
    );
    const timer = setTimeout(() => {
      defaultLogger.debug(
        `Running scheduled function after ${delayMs}ms - Scheduler ID: ${id}`,
      );
      (updateCheckpoint ? updateCheckpoint() : Promise.resolve())
        .then(() => startInvocation())
        .catch(onError)
        .finally(() => {
          this.runningTimers.delete(timer);
        });
    }, delayMs);
    this.runningTimers.add(timer);
  }

  /**
   * Cancels all pending timers and clears the scheduled function queue.
   *
   * After calling this method, no previously scheduled functions will execute,
   * even if their timers would have expired.
   */
  flushTimers(): void {
    if (this.runningTimers.size) {
      defaultLogger.debug(`Flushing ${this.runningTimers.size} pending timers`);
    }
    this.runningTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.runningTimers.clear();
  }

  /**
   * Checks whether there are any scheduled functions that have not yet
   * finished executing. This covers both pending timers and fired-but-
   * in-flight `startInvocation` work, so the orchestrator's PENDING-status
   * validation can rely on it as a single "is anything still queued or
   * running?" signal.
   *
   * @returns true if any scheduled function is pending or in flight, false otherwise
   */
  hasScheduledFunction(): boolean {
    return !!this.runningTimers.size;
  }
}
