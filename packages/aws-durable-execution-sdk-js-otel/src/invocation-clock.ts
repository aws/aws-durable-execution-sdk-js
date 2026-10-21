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
