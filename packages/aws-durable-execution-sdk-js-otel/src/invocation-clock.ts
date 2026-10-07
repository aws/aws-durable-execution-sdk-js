import type { HrTime } from "@opentelemetry/api";
import { millisToHrTime, otperformance } from "@opentelemetry/core";

export type InvocationClock = {
  epochMillis: number;
  monotonicMillis: number;
  sampleWindowMillis: number;
};

export function captureInvocationClock(): InvocationClock {
  let smallestWindow = Infinity;
  let bestSample: InvocationClock | undefined;
  // A pause between wall and monotonic reads would skew every live boundary
  // in this invocation. Prefer a narrow bracket, but never spin waiting for
  // an uninterrupted sample. Three attempts bound work, not scheduler delay.
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = otperformance.now();
    const epochMillis = Date.now();
    const after = otperformance.now();
    const window = after - before;
    if (window < smallestWindow) {
      smallestWindow = window;
      bestSample = {
        epochMillis,
        monotonicMillis: before + window / 2,
        sampleWindowMillis: window,
      };
    }
    if (window < 1) break;
  }
  return bestSample!;
}

export function readInvocationClock(clock: InvocationClock): HrTime {
  // Explicit absolute time avoids numeric TimeInput elapsed/epoch ambiguity.
  return millisToHrTime(
    clock.epochMillis + (otperformance.now() - clock.monotonicMillis),
  );
}

/** Latest whole-millisecond start consistent with the captured clock sample. */
export function invocationStartUpperBound(
  clock: InvocationClock,
  after: HrTime,
): HrTime {
  // The wall read can lie half a sample window from the midpoint. Date.now()
  // truncates its fractional millisecond, giving an exclusive upper bound of
  // after + uncertainty + 1 ms. The largest integer millisecond below that is
  // ceil(after + uncertainty), including when after + uncertainty is integral.
  // Work in relative nanoseconds so a large Unix epoch cannot erase a small
  // nonzero uncertainty. Rounding uncertainty outward to nanoseconds preserves
  // the same millisecond ceiling for the integer-nanosecond HrTime sample.
  const uncertaintyNanos = Math.ceil(
    (clock.sampleWindowMillis / 2) * 1_000_000,
  );
  const upperMillis = Math.ceil((after[1] + uncertaintyNanos) / 1_000_000);
  return [
    after[0] + Math.floor(upperMillis / 1000),
    (upperMillis % 1000) * 1_000_000,
  ];
}
