export class Scheduler {
  private hasScheduledFunctionFlag = false;
  private resolveWaitForScheduledFunction: (() => void) | undefined;
  private waitForScheduledFunctionPromise: Promise<void> = new Promise<void>(
    (resolve) => {
      this.resolveWaitForScheduledFunction = resolve;
    }
  );

  async waitForScheduledFunction(): Promise<void> {
    await this.waitForScheduledFunctionPromise;
    this.waitForScheduledFunctionPromise = new Promise((resolve) => {
      this.resolveWaitForScheduledFunction = resolve;
    });
  }

  scheduleFunction(
    fn: () => Promise<void>,
    delayMs: number,
    onError: (err: unknown) => void
  ): void {
    this.hasScheduledFunctionFlag = true;
    setTimeout(() => {
      this.hasScheduledFunctionFlag = false;
      fn().catch(onError);
    }, delayMs);
    this.resolveWaitForScheduledFunction?.();
  }

  // TODO: use this to check if there is a pending function invocation when the invocation status is PENDING
  // if there is no scheduled function and the invocation status is PENDING, the language SDK has a bug
  hasScheduledFunction(): boolean {
    return this.hasScheduledFunctionFlag;
  }
}
