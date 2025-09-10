import { createRetryStrategy } from ".";

describe("RetryStrategy", () => {
  describe("createRetryStrategy", () => {
    it("should use default config when no config is provided", () => {
      const strategy = createRetryStrategy();
      const error = new Error("Test error");

      // First attempt should retry
      const decision1 = strategy(error, 1);
      expect(decision1.shouldRetry).toBe(true);
      if (decision1.shouldRetry) {
        expect(decision1.delaySeconds).toBeGreaterThanOrEqual(4); // 5 seconds - 1 second jitter
        expect(decision1.delaySeconds).toBeLessThanOrEqual(6); // 5 seconds + 1 second jitter
      }

      // Second attempt should retry
      const decision2 = strategy(error, 2);
      expect(decision2.shouldRetry).toBe(true);
      if (decision2.shouldRetry) {
        expect(decision2.delaySeconds).toBeGreaterThanOrEqual(9); // 10 seconds - 1 second jitter
        expect(decision2.delaySeconds).toBeLessThanOrEqual(11); // 10 seconds + 1 second jitter
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
        initialDelaySeconds: 10,
        jitterSeconds: 0, // Remove jitter for predictable testing
      });
      const error = new Error("Test error");

      const decision = strategy(error, 1);
      expect(decision.shouldRetry).toBe(true);
      if (decision.shouldRetry) {
        expect(decision.delaySeconds).toBe(10);
      }
    });

    it("should respect custom backoffRate", () => {
      const strategy = createRetryStrategy({
        initialDelaySeconds: 5,
        backoffRate: 3,
        jitterSeconds: 0, // Remove jitter for predictable testing
      });
      const error = new Error("Test error");

      // First attempt: 5 seconds
      const decision1 = strategy(error, 1);
      expect(decision1.shouldRetry).toBe(true);
      if (decision1.shouldRetry) {
        expect(decision1.delaySeconds).toBe(5);
      }

      // Second attempt: 5 * 3 = 15 seconds
      const decision2 = strategy(error, 2);
      expect(decision2.shouldRetry).toBe(true);
      if (decision2.shouldRetry) {
        expect(decision2.delaySeconds).toBe(15);
      }
    });

    it("should respect maxDelaySeconds", () => {
      const strategy = createRetryStrategy({
        initialDelaySeconds: 100,
        maxDelaySeconds: 150,
        backoffRate: 2,
        jitterSeconds: 0, // Remove jitter for predictable testing
      });
      const error = new Error("Test error");

      // First attempt: 100 seconds
      const decision1 = strategy(error, 1);
      expect(decision1.shouldRetry).toBe(true);
      if (decision1.shouldRetry) {
        expect(decision1.delaySeconds).toBe(100);
      }

      // Second attempt would be 200 seconds, but capped at 150
      const decision2 = strategy(error, 2);
      expect(decision2.shouldRetry).toBe(true);
      if (decision2.shouldRetry) {
        expect(decision2.delaySeconds).toBe(150);
      }
    });

    it("should apply jitter correctly", () => {
      const strategy = createRetryStrategy({
        initialDelaySeconds: 10,
        jitterSeconds: 5,
      });
      const error = new Error("Test error");

      const decision = strategy(error, 1);
      expect(decision.shouldRetry).toBe(true);
      if (decision.shouldRetry) {
        expect(decision.delaySeconds).toBeGreaterThanOrEqual(5); // 10 - 5
        expect(decision.delaySeconds).toBeLessThanOrEqual(15); // 10 + 5
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
        retryableErrors: [], // Override default /.*/
      });

      // Error that should be retried
      const timeoutError = new TimeoutError("Operation timed out");
      expect(strategy(timeoutError, 1).shouldRetry).toBe(true);

      // Error that should not be retried
      const validationError = new ValidationError("Invalid input");
      expect(strategy(validationError, 1).shouldRetry).toBe(false);
    });

    it("should ensure minimum delay of 1 second", () => {
      const strategy = createRetryStrategy({
        initialDelaySeconds: 2,
        jitterSeconds: 3, // This could potentially make delay negative
      });
      const error = new Error("Test error");

      // Test multiple times to increase chance of hitting the minimum bound
      for (let i = 0; i < 10; i++) {
        const decision = strategy(error, 1);
        expect(decision.shouldRetry).toBe(true);
        if (decision.shouldRetry) {
          expect(decision.delaySeconds).toBeGreaterThanOrEqual(1);
        }
      }
    });

    it("should round delay to whole seconds", () => {
      const strategy = createRetryStrategy({
        initialDelaySeconds: 1.7,
        jitterSeconds: 0,
      });
      const error = new Error("Test error");

      const decision = strategy(error, 1);
      expect(decision.shouldRetry).toBe(true);
      if (decision.shouldRetry) {
        expect(decision.delaySeconds).toBe(2); // 1.7 rounded to 2
      }
    });
  });
});
