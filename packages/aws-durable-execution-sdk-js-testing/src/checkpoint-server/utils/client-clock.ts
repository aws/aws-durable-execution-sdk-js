/**
 * @fileoverview
 * The checkpoint server's view of the test runner's clock.
 *
 * The checkpoint server runs in a worker thread with its own real clock. With skipTime, the
 * test runner, the SDK and the handler read a fake clock on the main thread instead, which
 * the runner moves forward to skip waits. So every timestamp the server records must come
 * from the main thread's clock: otherwise scheduled ends, start times and history events
 * would each be on a different clock, and a wait's end would not match `Date.now()` in the
 * handler.
 *
 * Every request from the main thread carries the time on its clock when it was sent. The
 * server keeps the offset between that time and its own clock. Between requests, the main
 * thread's clock advances with real time, so real time plus the latest offset is the main
 * thread's current time. Without skipTime the offset stays close to zero.
 *
 * Each `setupTestEnvironment` starts a new worker, and so a new copy of this module. So one
 * copy only ever observes one main-thread clock.
 */

let offsetMs = 0;

/**
 * Records the main thread's clock as carried by a request.
 *
 * @param clientTimestampMs `Date.now()` on the main thread when the request was sent
 */
export function observeClientTime(clientTimestampMs: number | undefined): void {
  if (clientTimestampMs === undefined) {
    return;
  }
  offsetMs = clientTimestampMs - Date.now();
}

/**
 * @returns the current time on the main thread's clock, as last observed. Use an
 * {@link ExecutionClock} for times recorded in an execution, so they never go back.
 */
export function currentTime(): Date {
  return new Date(Date.now() + offsetMs);
}

/**
 * The main thread's clock as seen by one execution. Successive times never go back, so an
 * execution's recorded times stay in the order in which the server recorded them.
 *
 * The estimate from {@link currentTime} can run ahead of the main thread's clock, and a
 * later request then reports an earlier time. Two causes are known:
 *
 * 1. The fake clock follows real time in steps of its advance interval, 20 ms by default.
 * 2. A step that blocks the main thread synchronously also stops the fake clock. The worker
 *    keeps running meanwhile. It can record a time, for example when a callback times out.
 *
 * So the time holds at the latest time returned until the main thread's clock passes it.
 * A delay that starts during that hold ends later by up to the length of the hold. Each
 * execution has its own clock, so a hold in one execution does not affect the next one.
 */
export class ExecutionClock {
  private lastMs: number | undefined;

  /** @returns the current time on the main thread's clock, never before an earlier result */
  now(): Date {
    let nowMs = currentTime().getTime();
    if (this.lastMs !== undefined && nowMs < this.lastMs) {
      nowMs = this.lastMs;
    }
    this.lastMs = nowMs;
    return new Date(nowMs);
  }
}

/**
 * Forgets the observed offset. Should only be used in tests.
 * @internal
 */
export function resetClientTimeForTesting(): void {
  offsetMs = 0;
}
