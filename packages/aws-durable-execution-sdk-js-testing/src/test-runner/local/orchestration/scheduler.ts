export interface Scheduler {
  scheduleFunction(
    startInvocation: () => Promise<void>,
    onError: (err: unknown) => void,
    timestamp?: Date,
    updateCheckpoint?: () => Promise<void>,
  ): void;
  flushTimers(): void;
  hasScheduledFunction(): boolean;
}
