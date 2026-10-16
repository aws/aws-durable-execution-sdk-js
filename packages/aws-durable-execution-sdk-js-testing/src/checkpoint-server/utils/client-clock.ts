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
 * @returns the current time on the main thread's clock
 */
export function currentTime(): Date {
  return new Date(Date.now() + offsetMs);
}

/**
 * Forgets the observed offset. Should only be used in tests.
 * @internal
 */
export function resetClientTimeForTesting(): void {
  offsetMs = 0;
}
