import {
  defaultStepRetry,
  defaultWaitStrategy,
  normalizeStrategy,
} from "./strategy";

describe("normalizeStrategy", () => {
  it("returns the fallback for non-objects", () => {
    expect(normalizeStrategy(undefined, defaultStepRetry())).toEqual(
      defaultStepRetry(),
    );
    expect(normalizeStrategy(null, defaultWaitStrategy())).toEqual(
      defaultWaitStrategy(),
    );
  });

  it("merges partial values over the fallback", () => {
    const s = normalizeStrategy(
      { kind: "linear", maxAttempts: 7 },
      defaultStepRetry(),
    );
    expect(s.kind).toBe("linear");
    expect(s.maxAttempts).toBe(7);
    expect(s.initialDelaySeconds).toBe(defaultStepRetry().initialDelaySeconds);
  });

  it("coerces invalid kind/jitter to defaults", () => {
    const s = normalizeStrategy(
      { kind: "weird", jitter: "BOGUS" },
      defaultStepRetry(),
    );
    expect(s.kind).toBe("exponential");
    expect(s.jitter).toBe("FULL");
  });
});
