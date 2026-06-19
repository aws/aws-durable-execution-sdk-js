import { createLinearRetryStrategy } from "./linear-retry-strategy";
import { JitterStrategy } from "../../../types";

describe("createLinearRetryStrategy", () => {
  it("should create linear backoff delays", () => {
    const strategy = createLinearRetryStrategy({
      maxAttempts: 5,
      initialDelay: { seconds: 2 },
      increment: { seconds: 3 },
      jitter: JitterStrategy.NONE,
    });

    expect(strategy(new Error("test"), 1)).toEqual({
      shouldRetry: true,
      delay: { seconds: 2 }, // 2 + (3 * 0)
    });

    expect(strategy(new Error("test"), 2)).toEqual({
      shouldRetry: true,
      delay: { seconds: 5 }, // 2 + (3 * 1)
    });

    expect(strategy(new Error("test"), 3)).toEqual({
      shouldRetry: true,
      delay: { seconds: 8 }, // 2 + (3 * 2)
    });
  });

  it("should stop retrying after max attempts", () => {
    const strategy = createLinearRetryStrategy({ maxAttempts: 3 });

    expect(strategy(new Error("test"), 3)).toEqual({
      shouldRetry: false,
    });
  });

  it("should use default values", () => {
    const strategy = createLinearRetryStrategy({ jitter: JitterStrategy.NONE });

    expect(strategy(new Error("test"), 1)).toEqual({
      shouldRetry: true,
      delay: { seconds: 1 },
    });

    expect(strategy(new Error("test"), 2)).toEqual({
      shouldRetry: true,
      delay: { seconds: 2 },
    });
  });

  it("should default to 6 max attempts", () => {
    const strategy = createLinearRetryStrategy({ jitter: JitterStrategy.NONE });

    expect(strategy(new Error("test"), 5).shouldRetry).toBe(true);
    expect(strategy(new Error("test"), 6).shouldRetry).toBe(false);
  });

  it("should cap delay at maxDelay", () => {
    const strategy = createLinearRetryStrategy({
      maxAttempts: 10,
      initialDelay: { seconds: 5 },
      increment: { seconds: 10 },
      maxDelay: { seconds: 20 },
      jitter: JitterStrategy.NONE,
    });

    // 5 + 10 * (1-1) = 5
    expect(strategy(new Error("test"), 1).delay).toEqual({ seconds: 5 });
    // 5 + 10 * (2-1) = 15
    expect(strategy(new Error("test"), 2).delay).toEqual({ seconds: 15 });
    // 5 + 10 * (3-1) = 25, capped to 20
    expect(strategy(new Error("test"), 3).delay).toEqual({ seconds: 20 });
    // 5 + 10 * (4-1) = 35, capped to 20
    expect(strategy(new Error("test"), 4).delay).toEqual({ seconds: 20 });
  });

  it("should support Duration units other than seconds", () => {
    const strategy = createLinearRetryStrategy({
      maxAttempts: 5,
      initialDelay: { minutes: 1 },
      increment: { minutes: 1 },
      jitter: JitterStrategy.NONE,
    });

    expect(strategy(new Error("test"), 1).delay).toEqual({ seconds: 60 });
    expect(strategy(new Error("test"), 2).delay).toEqual({ seconds: 120 });
  });

  describe("jitter", () => {
    it("should apply FULL jitter within bounds", () => {
      const strategy = createLinearRetryStrategy({
        initialDelay: { seconds: 10 },
        increment: { seconds: 0 },
        jitter: JitterStrategy.FULL,
      });

      for (let i = 0; i < 20; i++) {
        const decision = strategy(new Error("test"), 1);
        expect(decision.shouldRetry).toBe(true);
        if (decision.shouldRetry) {
          expect(decision.delay!.seconds).toBeGreaterThanOrEqual(1);
          expect(decision.delay!.seconds).toBeLessThanOrEqual(10);
          expect(Number.isInteger(decision.delay!.seconds)).toBe(true);
        }
      }
    });

    it("should apply HALF jitter within bounds", () => {
      const strategy = createLinearRetryStrategy({
        initialDelay: { seconds: 10 },
        increment: { seconds: 0 },
        jitter: JitterStrategy.HALF,
      });

      for (let i = 0; i < 20; i++) {
        const decision = strategy(new Error("test"), 1);
        expect(decision.shouldRetry).toBe(true);
        if (decision.shouldRetry) {
          expect(decision.delay!.seconds).toBeGreaterThanOrEqual(5);
          expect(decision.delay!.seconds).toBeLessThanOrEqual(10);
        }
      }
    });

    it("should default jitter to FULL", () => {
      const strategy = createLinearRetryStrategy({
        initialDelay: { seconds: 10 },
        increment: { seconds: 0 },
      });

      for (let i = 0; i < 20; i++) {
        const decision = strategy(new Error("test"), 1);
        if (decision.shouldRetry) {
          expect(decision.delay!.seconds).toBeGreaterThanOrEqual(1);
          expect(decision.delay!.seconds).toBeLessThanOrEqual(10);
        }
      }
    });

    it("should always return integer delays >= 1", () => {
      const strategy = createLinearRetryStrategy({
        initialDelay: { seconds: 0.3 },
        increment: { seconds: 0.4 },
        jitter: JitterStrategy.FULL,
      });

      for (let i = 0; i < 20; i++) {
        const decision = strategy(new Error("test"), 1);
        expect(decision.shouldRetry).toBe(true);
        if (decision.shouldRetry) {
          expect(Number.isInteger(decision.delay!.seconds)).toBe(true);
          expect(decision.delay!.seconds).toBeGreaterThanOrEqual(1);
        }
      }
    });
  });

  describe("error filtering", () => {
    it("should retry all errors by default", () => {
      const strategy = createLinearRetryStrategy({
        jitter: JitterStrategy.NONE,
      });
      expect(strategy(new Error("anything"), 1).shouldRetry).toBe(true);
      expect(strategy(new Error("another"), 1).shouldRetry).toBe(true);
    });

    it("should filter retryable errors by message pattern", () => {
      const strategy = createLinearRetryStrategy({
        retryableErrors: [/timeout/i, "rate limit"],
        jitter: JitterStrategy.NONE,
      });

      expect(strategy(new Error("Request timeout"), 1).shouldRetry).toBe(true);
      expect(strategy(new Error("hit rate limit"), 1).shouldRetry).toBe(true);
      expect(strategy(new Error("invalid input"), 1).shouldRetry).toBe(false);
    });

    it("should filter retryable errors by error type", () => {
      class TimeoutError extends Error {}
      class ValidationError extends Error {}

      const strategy = createLinearRetryStrategy({
        retryableErrorTypes: [TimeoutError],
        jitter: JitterStrategy.NONE,
      });

      expect(strategy(new TimeoutError("timed out"), 1).shouldRetry).toBe(true);
      expect(strategy(new ValidationError("bad"), 1).shouldRetry).toBe(false);
      expect(strategy(new Error("generic"), 1).shouldRetry).toBe(false);
    });

    it("should combine error filters with OR logic", () => {
      class TimeoutError extends Error {}

      const strategy = createLinearRetryStrategy({
        retryableErrors: [/network/i],
        retryableErrorTypes: [TimeoutError],
        jitter: JitterStrategy.NONE,
      });

      expect(strategy(new TimeoutError("timed out"), 1).shouldRetry).toBe(true);
      expect(strategy(new Error("Network failure"), 1).shouldRetry).toBe(true);
      expect(strategy(new Error("invalid input"), 1).shouldRetry).toBe(false);
    });
  });
});
