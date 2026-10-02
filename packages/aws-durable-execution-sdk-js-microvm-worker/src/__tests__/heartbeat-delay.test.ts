import {
  heartbeatCallTimeoutMs,
  heartbeatDelayMs,
  heartbeatRetryDelayMs,
} from "../worker";

describe("heartbeatDelayMs", () => {
  it("subtracts 1 second at the low end of the jitter", () => {
    expect(heartbeatDelayMs(10_000, () => 0)).toBe(9_000);
  });

  it("subtracts 2 seconds at the high end of the jitter", () => {
    expect(heartbeatDelayMs(10_000, () => 1)).toBe(8_000);
  });

  it("stays between the interval minus 2 seconds and minus 1 second", () => {
    for (let i = 0; i < 1_000; i++) {
      const delay = heartbeatDelayMs(10_000);
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
    [333, 166],
    [1_000, 500],
    [8_000, 4_000],
    [15 * 60 * 1_000, 7.5 * 60 * 1_000],
  ])(
    "gives an interval of %p ms a call timeout of %p ms",
    (interval, expected) => {
      expect(heartbeatCallTimeoutMs(interval)).toBe(expected);
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
