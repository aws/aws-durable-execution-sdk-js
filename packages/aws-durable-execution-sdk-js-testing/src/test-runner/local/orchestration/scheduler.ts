import { defaultLogger } from "../../../logger";

export class Scheduler {
  private resolveWaitForScheduledFunction: (() => void) | undefined;
  private waitForScheduledFunctionPromise: Promise<void> = new Promise<void>(
    (resolve) => {
      this.resolveWaitForScheduledFunction = resolve;
    },
  );
  private readonly runningTimers = new Set<NodeJS.Timeout>();

  async waitForScheduledFunction(): Promise<void> {
    await this.waitForScheduledFunctionPromise;
    this.waitForScheduledFunctionPromise = new Promise((resolve) => {
      this.resolveWaitForScheduledFunction = resolve;
    });
  }

  scheduleFunction(
    fn: () => Promise<void>,
    delayMs: number,
    onError: (err: unknown) => void,
  ): void {
    const timer = setTimeout(() => {
      this.runningTimers.delete(timer);
      fn().catch(onError);
    }, delayMs);
    this.runningTimers.add(timer);
    this.resolveWaitForScheduledFunction?.();
  }

  flushTimers() {
    if (this.runningTimers.size) {
      defaultLogger.debug(`Flushing ${this.runningTimers.size} pending timers`);
    }
    this.runningTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.runningTimers.clear();
  }

  // TODO: use this to check if there is a pending function invocation when the invocation status is PENDING
  // if there is no scheduled function and the invocation status is PENDING, the language SDK has a bug
  hasScheduledFunction(): boolean {
    return !!this.runningTimers.size;
  }
}
