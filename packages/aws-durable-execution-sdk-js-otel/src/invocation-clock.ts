import type { HrTime } from "@opentelemetry/api";
import { millisToHrTime, otperformance } from "@opentelemetry/core";

export type InvocationClock = {
  epochMillis: number;
  monotonicMillis: number;
};

/** Match ordinary OTel spans: a wall-clock origin plus monotonic elapsed time. */
export function captureInvocationClock(): InvocationClock {
  return {
    epochMillis: Date.now(),
    monotonicMillis: otperformance.now(),
  };
}

export function readInvocationClock(clock: InvocationClock): HrTime {
  // HrTime explicitly denotes absolute time; numeric TimeInput can be relative.
  return millisToHrTime(
    clock.epochMillis + (otperformance.now() - clock.monotonicMillis),
  );
}
