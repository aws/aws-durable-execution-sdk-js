import { createRetryStrategy, JitterStrategy } from ".";

describe("RetryStrategy", () => {
  describe("createRetryStrategy", () => {
    it("should use default config when no config is provided", () => {
      const strategy = createRetryStrategy();
      const error = new Error("Test error");

      // First attempt should retry with FULL jitter (0 to delay)
      const decision1 = strategy(error, 1);
      expect(decision1.shouldRetry).toBe(true);
      if (decision1.shouldRetry) {
        expect(decision1.delay).not.toBeUndefined();
        expect(decision1.delay!.seconds).toBeGreaterThanOrEqual(1); // Min 1 second
        expect(decision1.delay!.seconds).toBeLessThanOrEqual(5); // Max 5 seconds (FULL jitter)
      }

      // Second attempt should retry
      const decision2 = strategy(error, 2);
      expect(decision2.shouldRetry).toBe(true);
      if (decision2.shouldRetry) {
        expect(decision2.delay).not.toBeUndefined();
        expect(decision2.delay!.seconds).toBeGreaterThanOrEqual(1); // Min 1 second
        expect(decision2.delay!.seconds).toBeLessThanOrEqual(10); // Max 10 seconds (FULL jitter)
      }

      // Third attempt should not retry (maxAttempts = 3)
      const decision3 = strategy(error, 3);
      expect(decision3.shouldRetry).toBe(false);
    });

    it("should respect custom maxAttempts", () => {
      const strategy = createRetryStrategy({ maxAttempts: 5 });
      const error = new Error("Test error");

      // Third attempt should still retry
      const decision = strategy(error, 3);
      expect(decision.shouldRetry).toBe(true);

      // Fifth attempt should not retry
      const decision5 = strategy(error, 5);
      expect(decision5.shouldRetry).toBe(false);
    });

    it("should respect custom initialDelaySeconds", () => {
      const strategy = createRetryStrategy({
        initialDelay: { seconds: 10 },
        jitter: JitterStrategy.NONE,
      });
      const error = new Error("Test error");

      const decision = strategy(error, 1);
      expect(decision.shouldRetry).toBe(true);
      if (decision.shouldRetry) {
        expect(decision.delay).not.toBeUndefined();
        expect(decision.delay!.seconds).toBe(10);
      }
    });

    it("should respect custom backoffRate", () => {
      const strategy = createRetryStrategy({
        initialDelay: { seconds: 5 },
        backoffRate: 3,
        jitter: JitterStrategy.NONE,
      });
      const error = new Error("Test error");

      // First attempt: 5 seconds
      const decision1 = strategy(error, 1);
      expect(decision1.shouldRetry).toBe(true);
      if (decision1.shouldRetry) {
        expect(decision1.delay).not.toBeUndefined();
        expect(decision1.delay!.seconds).toBe(5);
      }

      // Second attempt: 5 * 3 = 15 seconds
      const decision2 = strategy(error, 2);
      expect(decision2.shouldRetry).toBe(true);
      if (decision2.shouldRetry) {
        expect(decision2.delay).not.toBeUndefined();
        expect(decision2.delay!.seconds).toBe(15);
      }
    });

    it("should respect maxDelaySeconds", () => {
      const strategy = createRetryStrategy({
        initialDelay: { seconds: 100 },
        maxDelay: { seconds: 150 },
        backoffRate: 2,
        jitter: JitterStrategy.NONE,
      });
      const error = new Error("Test error");

      // First attempt: 100 seconds
      const decision1 = strategy(error, 1);
      expect(decision1.shouldRetry).toBe(true);
      if (decision1.shouldRetry) {
        expect(decision1.delay).not.toBeUndefined();
        expect(decision1.delay!.seconds).toBe(100);
      }

      // Second attempt would be 200 seconds, but capped at 150
      const decision2 = strategy(error, 2);
      expect(decision2.shouldRetry).toBe(true);
      if (decision2.shouldRetry) {
        expect(decision2.delay).not.toBeUndefined();
        expect(decision2.delay!.seconds).toBe(150);
      }
    });

    it("should apply FULL jitter correctly", () => {
      const strategy = createRetryStrategy({
        initialDelay: { seconds: 10 },
        jitter: JitterStrategy.FULL,
      });
      const error = new Error("Test error");

      const decision = strategy(error, 1);
      expect(decision.shouldRetry).toBe(true);
      if (decision.shouldRetry) {
        expect(decision.delay).not.toBeUndefined();
        expect(decision.delay!.seconds).toBeGreaterThanOrEqual(1); // Min 1 second
        expect(decision.delay).not.toBeUndefined();
        expect(decision.delay!.seconds).toBeLessThanOrEqual(10); // Max delay
      }
    });

    it("should apply HALF jitter correctly", () => {
      const strategy = createRetryStrategy({
        initialDelay: { seconds: 10 },
        jitter: JitterStrategy.HALF,
      });
      const error = new Error("Test error");

      const decision = strategy(error, 1);
      expect(decision.shouldRetry).toBe(true);
      if (decision.shouldRetry) {
        expect(decision.delay).not.toBeUndefined();
        expect(decision.delay!.seconds).toBeGreaterThanOrEqual(5); // delay/2
        expect(decision.delay).not.toBeUndefined();
        expect(decision.delay!.seconds).toBeLessThanOrEqual(10); // delay
      }
    });

    it("should apply NONE jitter correctly", () => {
      const strategy = createRetryStrategy({
        initialDelay: { seconds: 10 },
        jitter: JitterStrategy.NONE,
      });
      const error = new Error("Test error");

      const decision = strategy(error, 1);
      expect(decision.shouldRetry).toBe(true);
      if (decision.shouldRetry) {
        expect(decision.delay).not.toBeUndefined();
        expect(decision.delay!.seconds).toBe(10); // Exact delay
      }
    });

    it("should handle invalid jitter strategy by returning delay unchanged", () => {
      const strategy = createRetryStrategy({
        initialDelay: { seconds: 10 },
        jitter: "INVALID" as any, // Force invalid value
      });
      const error = new Error("Test error");

      const decision = strategy(error, 1);
      expect(decision.shouldRetry).toBe(true);
      if (decision.shouldRetry) {
        expect(decision.delay).not.toBeUndefined();
        expect(decision.delay!.seconds).toBe(10); // Should return delay unchanged
      }
    });

    it("should filter retryable errors by message string", () => {
      const strategy = createRetryStrategy({
        retryableErrors: ["retry this"],
      });

      // Error that should be retried
      const retryableError = new Error("Please retry this error");
      const decision1 = strategy(retryableError, 1);
      expect(decision1.shouldRetry).toBe(true);

      // Error that should not be retried
      const nonRetryableError = new Error("Do not retry");
      const decision2 = strategy(nonRetryableError, 1);
      expect(decision2.shouldRetry).toBe(false);
    });

    it("should filter retryable errors by regex pattern", () => {
      const strategy = createRetryStrategy({
        retryableErrors: [/timed out/i, /connection refused/i],
        retryableErrorTypes: [], // Override default /.*/
      });

      // Errors that should be retried
      const timeoutError = new Error("Operation timed out");
      const connectionError = new Error("Connection refused");

      // Check if the regex is matching correctly
      const timeoutRegex = /timed out/i;
      const connectionRegex = /connection refused/i;

      // These should be true
      expect(timeoutRegex.test(timeoutError.message)).toBe(true);
      expect(connectionRegex.test(connectionError.message)).toBe(true);

      // Now test the strategy
      const timeoutDecision = strategy(timeoutError, 1);
      const connectionDecision = strategy(connectionError, 1);

      expect(timeoutDecision.shouldRetry).toBe(true);
      expect(connectionDecision.shouldRetry).toBe(true);

      // Error that should not be retried
      const otherError = new Error("Invalid input");
      expect(strategy(otherError, 1).shouldRetry).toBe(false);
    });

    it("should filter retryable errors by error type", () => {
      class TimeoutError extends Error {}
      class ValidationError extends Error {}

      const strategy = createRetryStrategy({
        retryableErrorTypes: [TimeoutError],
      });

      // Error that should be retried
      const timeoutError = new TimeoutError("Operation timed out");
      expect(strategy(timeoutError, 1).shouldRetry).toBe(true);

      // Error that should not be retried (different type)
      const validationError = new ValidationError("Invalid input");
      expect(strategy(validationError, 1).shouldRetry).toBe(false);

      // Generic Error should not be retried (not in retryableErrorTypes)
      const genericError = new Error("Some error");
      expect(strategy(genericError, 1).shouldRetry).toBe(false);
    });

    it("should combine retryableErrors and retryableErrorTypes with OR logic", () => {
      class TimeoutError extends Error {}

      const strategy = createRetryStrategy({
        retryableErrors: [/network/i],
        retryableErrorTypes: [TimeoutError],
      });

      // Should retry: matches error type
      const timeoutError = new TimeoutError("Operation timed out");
      expect(strategy(timeoutError, 1).shouldRetry).toBe(true);

      // Should retry: matches error message pattern
      const networkError = new Error("Network failure");
      expect(strategy(networkError, 1).shouldRetry).toBe(true);

      // Should not retry: matches neither
      const otherError = new Error("Invalid input");
      expect(strategy(otherError, 1).shouldRetry).toBe(false);
    });

    it("should not apply default regex when only retryableErrorTypes is specified", () => {
      class NetworkError extends Error {}

      const strategy = createRetryStrategy({
        retryableErrorTypes: [NetworkError],
      });

      // Should retry: matches error type
      const networkError = new NetworkError("Connection failed");
      expect(strategy(networkError, 1).shouldRetry).toBe(true);

      // Should NOT retry: generic Error doesn't match type, and default regex not applied
      const genericError = new Error("Some random error");
      expect(strategy(genericError, 1).shouldRetry).toBe(false);
    });

    it("should not apply default regex when only retryableErrors is specified", () => {
      const strategy = createRetryStrategy({
        retryableErrors: [/timeout/i],
      });

      // Should retry: matches pattern
      const timeoutError = new Error("Request timeout");
      expect(strategy(timeoutError, 1).shouldRetry).toBe(true);

      // Should NOT retry: doesn't match pattern
      const otherError = new Error("Invalid input");
      expect(strategy(otherError, 1).shouldRetry).toBe(false);
    });

    it("should apply default regex only when neither filter is specified", () => {
      const strategy = createRetryStrategy({
        maxAttempts: 5,
      });

      // Should retry: default regex matches all errors
      const anyError1 = new Error("Network error");
      expect(strategy(anyError1, 1).shouldRetry).toBe(true);

      const anyError2 = new Error("Validation error");
      expect(strategy(anyError2, 1).shouldRetry).toBe(true);

      const anyError3 = new Error("Random error");
      expect(strategy(anyError3, 1).shouldRetry).toBe(true);
    });

    it("should ensure minimum delay of 1 second", () => {
      const strategy = createRetryStrategy({
        initialDelay: { seconds: 2 },
        jitter: JitterStrategy.FULL,
      });
      const error = new Error("Test error");

      // Test multiple times to increase chance of hitting the minimum bound
      for (let i = 0; i < 10; i++) {
        const decision = strategy(error, 1);
        expect(decision.shouldRetry).toBe(true);
        if (decision.shouldRetry) {
          expect(decision.delay).not.toBeUndefined();
          expect(decision.delay!.seconds).toBeGreaterThanOrEqual(1);
        }
      }
    });

    it("should round delay to whole seconds", () => {
      const strategy = createRetryStrategy({
        initialDelay: { seconds: 1.7 },
        jitter: JitterStrategy.NONE,
      });
      const error = new Error("Test error");

      const decision = strategy(error, 1);
      expect(decision.shouldRetry).toBe(true);
      if (decision.shouldRetry) {
        expect(decision.delay).not.toBeUndefined();
        expect(decision.delay!.seconds).toBe(2); // 1.7 rounded to 2
      }
    });

    it("should always return integer delays >= 1", () => {
      const strategy = createRetryStrategy({
        initialDelay: { seconds: 0.3 }, // Very small delay
        jitter: JitterStrategy.FULL,
      });
      const error = new Error("Test error");

      // Test multiple times to ensure all random values are integers >= 1
      for (let i = 0; i < 20; i++) {
        const decision = strategy(error, 1);
        expect(decision.shouldRetry).toBe(true);
        if (decision.shouldRetry) {
          expect(decision.delay).not.toBeUndefined();
          expect(Number.isInteger(decision.delay!.seconds)).toBe(true);
          expect(decision.delay!.seconds).toBeGreaterThanOrEqual(1);
        }
      }
    });
  });
});
