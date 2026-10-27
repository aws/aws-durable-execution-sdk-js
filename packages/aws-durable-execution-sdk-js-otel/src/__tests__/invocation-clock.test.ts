import { otperformance } from "@opentelemetry/core";
import {
  captureInvocationClock,
  readInvocationClock,
} from "../invocation-clock";

describe("per-invocation wall origin and monotonic elapsed time", () => {
  let wall: number;
  let monotonic: number;
  let descriptor: PropertyDescriptor | undefined;
  beforeEach(() => {
    wall = 1_700_000_000_000;
    monotonic = 100;
    jest.spyOn(Date, "now").mockImplementation(() => wall);
    descriptor = Object.getOwnPropertyDescriptor(otperformance, "now");
    Object.defineProperty(otperformance, "now", {
      configurable: true,
      value: () => monotonic,
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (descriptor) Object.defineProperty(otperformance, "now", descriptor);
    else Reflect.deleteProperty(otperformance, "now");
  });

  it("returns absolute HrTime with elapsed milliseconds converted to nanoseconds", () => {
    const clock = captureInvocationClock();
    monotonic += 1250.25;
    expect(readInvocationClock(clock)).toEqual([1_700_000_001, 250_250_000]);
  });

  it("does not resample wall time while advancing one invocation", () => {
    const clock = captureInvocationClock();
    wall -= 60_000;
    monotonic += 25;
    expect(readInvocationClock(clock)).toEqual([1_700_000_000, 25_000_000]);
    wall += 120_000;
    monotonic += 25;
    expect(readInvocationClock(clock)).toEqual([1_700_000_000, 50_000_000]);
    expect(Date.now).toHaveBeenCalledTimes(1);
  });

  it("captures a fresh wall origin for a subsequent invocation", () => {
    const first = captureInvocationClock();
    wall -= 10_000;
    monotonic += 500;
    const resumed = captureInvocationClock();
    monotonic += 25;
    expect(readInvocationClock(resumed)).toEqual([1_699_999_990, 25_000_000]);
    expect(readInvocationClock(first)).toEqual([1_700_000_000, 525_000_000]);
  });

  it("returns an absolute tuple even when the wall epoch is smaller than performance.now", () => {
    wall = 1000;
    monotonic = 100_000;
    const clock = captureInvocationClock();
    monotonic += 0.5;
    expect(readInvocationClock(clock)).toEqual([1, 500_000]);
  });
});
