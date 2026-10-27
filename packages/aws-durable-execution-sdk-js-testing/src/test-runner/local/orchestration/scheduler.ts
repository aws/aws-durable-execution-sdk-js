export interface Scheduler {
  scheduleFunction(
    startInvocation: () => Promise<void>,
    onError: (err: unknown) => void,
    timestamp?: Date,
    updateCheckpoint?: () => Promise<void>,
  ): void;
  flushTimers(): void;

  /**
   * Reports whether the scheduler owns work that can still make progress.
   *
   * Implementations intentionally differ at the invocation boundary.
   * TimerScheduler retains an entry through its checkpoint update but removes
   * it before startInvocation, preserving no-work PENDING validation.
   * QueueScheduler remains active throughout its sequential processing loop,
   * including startInvocation.
   */
  hasScheduledFunction(): boolean;
}
