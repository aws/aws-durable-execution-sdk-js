import {
  heartbeatCallTimeoutMs,
  heartbeatDelayMs,
  heartbeatRetryDelayMs,
  jitterSource,
} from "../worker";

describe("heartbeatDelayMs", () => {
  it("subtracts 1 second at the low end of the jitter", () => {
    expect(heartbeatDelayMs(10_000, () => 0)).toBe(9_000);
  });

  it("subtracts 2 seconds at the high end of the jitter", () => {
    expect(heartbeatDelayMs(10_000, () => 1)).toBe(8_000);
  });

  it("stays between the interval minus 2 seconds and minus 1 second", () => {
    const random = jitterSource("cb-1");
    for (let i = 0; i < 1_000; i++) {
      const delay = heartbeatDelayMs(10_000, random);
      expect(delay).toBeGreaterThanOrEqual(8_000);
      expect(delay).toBeLessThanOrEqual(9_000);
    }
  });

  it("caps the jitter at half the interval", () => {
    // The shortest default interval is 1 second.
    expect(heartbeatDelayMs(1_000, () => 0)).toBe(500);
    expect(heartbeatDelayMs(3_000, () => 1)).toBe(1_500);
    expect(heartbeatDelayMs(20, () => 0.5)).toBe(10);
  });
});

describe("heartbeatCallTimeoutMs", () => {
  it.each([
    [333, 111],
    [1_000, 333],
    [9_000, 3_000],
    [15 * 60 * 1_000, 5 * 60 * 1_000],
  ])(
    "gives an interval of %p ms a call timeout of %p ms",
    (interval, expected) => {
      expect(heartbeatCallTimeoutMs(interval)).toBe(expected);
    },
  );

  // The service times the heartbeat timeout from when it receives a call,
  // which can be at the call's start. So the worst gap with two failures in
  // a row counts the whole last good call, both failed calls with their
  // retry waits, the wait after the good call, and the whole next good call.
  it.each([300, 1_000, 2_000, 4_000, 10_000, 60_000, 15 * 60 * 1_000])(
    "keeps two failures in a row within the heartbeat timeout for an interval of %p ms",
    (interval) => {
      const call = heartbeatCallTimeoutMs(interval);
      const longestWait = heartbeatDelayMs(interval, () => 0);
      const longestRetryWait = heartbeatRetryDelayMs(interval, () => 0);
      const gap = call + longestWait + 2 * (call + longestRetryWait) + call;
      // The heartbeat timeout is at least three intervals.
      expect(gap).toBeLessThan(3 * interval);
    },
  );
});

describe("heartbeatRetryDelayMs", () => {
  it("waits a quarter interval at the low end of the jitter", () => {
    expect(heartbeatRetryDelayMs(8_000, () => 0)).toBe(2_000);
  });

  it("waits an eighth of the interval at the high end of the jitter", () => {
    expect(heartbeatRetryDelayMs(8_000, () => 1)).toBe(1_000);
  });

  it("waits at least 1 millisecond", () => {
    expect(heartbeatRetryDelayMs(1, () => 1)).toBe(1);
  });
});

describe("jitterSource", () => {
  const take = (source: () => number, count: number): number[] =>
    Array.from({ length: count }, source);

  it("returns numbers in [0, 1)", () => {
    for (const value of take(jitterSource("cb-1"), 1_000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("returns a different sequence for each callback ID", () => {
    // Two MicroVMs restored from one snapshot share the Math.random state.
    // Their jobs have different callback IDs, so their delays differ.
    expect(take(jitterSource("cb-a"), 5)).not.toEqual(
      take(jitterSource("cb-b"), 5),
    );
  });

  it("returns the same sequence for the same callback ID", () => {
    expect(take(jitterSource("cb-a"), 5)).toEqual(
      take(jitterSource("cb-a"), 5),
    );
  });

  it("returns a different value on each call", () => {
    const values = take(jitterSource("cb-a"), 100);
    expect(new Set(values).size).toBe(100);
  });

  it("does not read Math.random", () => {
    const spy = jest.spyOn(Math, "random");
    try {
      take(jitterSource("cb-a"), 10);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
