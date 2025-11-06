import { createWaitStrategy } from "./wait-strategy-config";
import { JitterStrategy } from "../../types";

describe("createWaitStrategy", () => {
  describe("Basic functionality", () => {
    it("should return shouldContinue: false when condition is met", () => {
      const strategy = createWaitStrategy({
        shouldContinuePolling: (result: string) => result !== "READY",
      });

      const decision = strategy("READY", 1);

      expect(decision).toEqual({ shouldContinue: false });
    });

    it("should return shouldContinue: true with delay when condition is not met", () => {
      const strategy = createWaitStrategy({
        shouldContinuePolling: (result: string) => result !== "READY",
      });

      const decision = strategy("PENDING", 1);

      expect(decision.shouldContinue).toBe(true);
      if (decision.shouldContinue) {
        expect(decision.delay.seconds).toBeGreaterThan(0);
      }
    });
  });

  describe("Default configuration", () => {
    it("should use default values when not specified", () => {
      const strategy = createWaitStrategy({
        shouldContinuePolling: () => true,
      });

      const decision = strategy("test", 1);

      expect(decision.shouldContinue).toBe(true);
      if (decision.shouldContinue) {
        // Default initialDelaySeconds is 5 with FULL jitter (0 to 5)
        expect(decision.delay.seconds).toBeGreaterThanOrEqual(1); // Min 1 second
        expect(decision.delay.seconds).toBeLessThanOrEqual(5); // Max 5 seconds
      }
    });

    it("should respect maxAttempts default (60)", () => {
      const strategy = createWaitStrategy({
        shouldContinuePolling: () => true,
      });

      // Should not throw for attempts up to 59 (since we check attemptsMade >= maxAttempts)
      expect(() => strategy("test", 59)).not.toThrow();

      // Should throw when reaching maxAttempts
      expect(() => strategy("test", 60)).toThrow(
        "waitForCondition exceeded maximum attempts (60)",
      );
    });
  });

  describe("Custom configuration", () => {
    it("should use custom maxAttempts", () => {
      const strategy = createWaitStrategy({
        maxAttempts: 3,
        shouldContinuePolling: () => true,
      });

      // Should work for attempts up to 2 (since we check attemptsMade >= maxAttempts)
      expect(() => strategy("test", 2)).not.toThrow();

      // Should throw when reaching maxAttempts
      expect(() => strategy("test", 3)).toThrow(
        "waitForCondition exceeded maximum attempts (3)",
      );
    });

    it("should use custom initialDelaySeconds", () => {
      const strategy = createWaitStrategy({
        initialDelay: { seconds: 10 },
        jitter: JitterStrategy.NONE, // Remove jitter for predictable testing
        shouldContinuePolling: () => true,
      });

      const decision = strategy("test", 1);

      if (decision.shouldContinue) {
        expect(decision.delay.seconds).toBe(10);
      }
    });

    it("should use custom maxDelaySeconds", () => {
      const strategy = createWaitStrategy({
        initialDelay: { seconds: 100 },
        maxDelay: { seconds: 50 },
        backoffRate: 2,
        jitter: JitterStrategy.NONE, // Remove jitter for predictable testing
        shouldContinuePolling: () => true,
      });

      const decision = strategy("test", 1);

      if (decision.shouldContinue) {
        // Should be capped at maxDelaySeconds
        expect(decision.delay.seconds).toBe(50);
      }
    });

    it("should use custom backoffRate", () => {
      const strategy = createWaitStrategy({
        initialDelay: { seconds: 10 },
        backoffRate: 3,
        jitter: JitterStrategy.NONE, // Remove jitter for predictable testing
        shouldContinuePolling: () => true,
      });

      const decision1 = strategy("test", 1);
      const decision2 = strategy("test", 2);
      const decision3 = strategy("test", 3);

      if (
        decision1.shouldContinue &&
        decision2.shouldContinue &&
        decision3.shouldContinue
      ) {
        expect(decision1.delay.seconds).toBe(10); // 10 * 3^0 = 10
        expect(decision2.delay.seconds).toBe(30); // 10 * 3^1 = 30
        expect(decision3.delay.seconds).toBe(90); // 10 * 3^2 = 90
      }
    });
  });

  describe("Exponential backoff", () => {
    it("should implement exponential backoff correctly", () => {
      const strategy = createWaitStrategy({
        initialDelay: { seconds: 2 },
        backoffRate: 2,
        jitter: JitterStrategy.NONE, // Remove jitter for predictable testing
        shouldContinuePolling: () => true,
      });

      const decision1 = strategy("test", 1);
      const decision2 = strategy("test", 2);
      const decision3 = strategy("test", 3);
      const decision4 = strategy("test", 4);

      if (
        decision1.shouldContinue &&
        decision2.shouldContinue &&
        decision3.shouldContinue &&
        decision4.shouldContinue
      ) {
        expect(decision1.delay.seconds).toBe(2); // 2 * 2^0 = 2
        expect(decision2.delay.seconds).toBe(4); // 2 * 2^1 = 4
        expect(decision3.delay.seconds).toBe(8); // 2 * 2^2 = 8
        expect(decision4.delay.seconds).toBe(16); // 2 * 2^3 = 16
      }
    });

    it("should cap delay at maxDelaySeconds", () => {
      const strategy = createWaitStrategy({
        initialDelay: { seconds: 10 },
        maxDelay: { seconds: 25 },
        backoffRate: 2,
        jitter: JitterStrategy.NONE, // Remove jitter for predictable testing
        shouldContinuePolling: () => true,
      });

      const decision1 = strategy("test", 1);
      const decision2 = strategy("test", 2);
      const decision3 = strategy("test", 3);

      if (
        decision1.shouldContinue &&
        decision2.shouldContinue &&
        decision3.shouldContinue
      ) {
        expect(decision1.delay.seconds).toBe(10); // 10 * 2^0 = 10
        expect(decision2.delay.seconds).toBe(20); // 10 * 2^1 = 20
        expect(decision3.delay.seconds).toBe(25); // 10 * 2^2 = 40, capped at 25
      }
    });
  });

  describe("Jitter", () => {
    it("should apply FULL jitter to delay", () => {
      const strategy = createWaitStrategy({
        initialDelay: { seconds: 10 },
        jitter: JitterStrategy.FULL,
        shouldContinuePolling: () => true,
      });

      // Run multiple times to test jitter randomness
      const delays = [];
      for (let i = 0; i < 10; i++) {
        const decision = strategy("test", 1);
        if (decision.shouldContinue) {
          delays.push(decision.delay.seconds);
        }
      }

      // FULL jitter: random between 0 and delay (0 to 10), but min 1
      delays.forEach((delay) => {
        expect(delay).toBeGreaterThanOrEqual(1); // Min 1 second
        expect(delay).toBeLessThanOrEqual(10); // Max 10 seconds
      });

      // Should have some variation (not all the same)
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });

    it("should apply HALF jitter to delay", () => {
      const strategy = createWaitStrategy({
        initialDelay: { seconds: 10 },
        jitter: JitterStrategy.HALF,
        shouldContinuePolling: () => true,
      });

      // Run multiple times to test jitter randomness
      const delays = [];
      for (let i = 0; i < 10; i++) {
        const decision = strategy("test", 1);
        if (decision.shouldContinue) {
          delays.push(decision.delay.seconds);
        }
      }

      // HALF jitter: random between delay/2 and delay (5 to 10)
      delays.forEach((delay) => {
        expect(delay).toBeGreaterThanOrEqual(5); // Min delay/2
        expect(delay).toBeLessThanOrEqual(10); // Max delay
      });

      // Should have some variation (not all the same)
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });

    it("should apply NONE jitter (no randomness)", () => {
      const strategy = createWaitStrategy({
        initialDelay: { seconds: 10 },
        jitter: JitterStrategy.NONE,
        shouldContinuePolling: () => true,
      });

      // Run multiple times - should always be the same
      const delays = [];
      for (let i = 0; i < 10; i++) {
        const decision = strategy("test", 1);
        if (decision.shouldContinue) {
          delays.push(decision.delay.seconds);
        }
      }

      // NONE jitter: always exact delay
      delays.forEach((delay) => {
        expect(delay).toBe(10);
      });

      // Should have no variation (all the same)
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBe(1);
    });

    it("should ensure minimum delay of 1 second even with negative jitter", () => {
      const strategy = createWaitStrategy({
        initialDelay: { seconds: 1 },
        jitter: JitterStrategy.FULL, // Could make delay negative
        shouldContinuePolling: () => true,
      });

      // Run multiple times to catch edge cases
      for (let i = 0; i < 20; i++) {
        const decision = strategy("test", 1);
        if (decision.shouldContinue) {
          expect(decision.delay.seconds).toBeGreaterThanOrEqual(1);
        }
      }
    });
  });

  describe("shouldContinuePolling function", () => {
    it("should call shouldContinuePolling with correct result", () => {
      const mockShouldContinue = jest.fn().mockReturnValue(false);
      const strategy = createWaitStrategy({
        shouldContinuePolling: mockShouldContinue,
      });

      const testResult = { status: "COMPLETE", data: "test" };
      strategy(testResult, 1);

      expect(mockShouldContinue).toHaveBeenCalledWith(testResult);
    });

    it("should work with different result types", () => {
      // String result
      const stringStrategy = createWaitStrategy({
        shouldContinuePolling: (result: string) => result !== "done",
      });

      expect(stringStrategy("done", 1)).toEqual({ shouldContinue: false });
      expect(stringStrategy("pending", 1).shouldContinue).toBe(true);

      // Number result
      const numberStrategy = createWaitStrategy({
        shouldContinuePolling: (result: number) => result < 100,
      });

      expect(numberStrategy(100, 1)).toEqual({ shouldContinue: false });
      expect(numberStrategy(50, 1).shouldContinue).toBe(true);

      // Object result
      interface StatusResult {
        status: string;
        progress: number;
      }

      const objectStrategy = createWaitStrategy({
        shouldContinuePolling: (result: StatusResult) =>
          result.status !== "complete",
      });

      expect(objectStrategy({ status: "complete", progress: 100 }, 1)).toEqual({
        shouldContinue: false,
      });
      expect(
        objectStrategy({ status: "running", progress: 50 }, 1).shouldContinue,
      ).toBe(true);
    });
  });

  describe("Error handling", () => {
    it("should throw error when maxAttempts is exceeded", () => {
      const strategy = createWaitStrategy({
        maxAttempts: 2,
        shouldContinuePolling: () => true,
      });

      expect(() => strategy("test", 3)).toThrow(
        "waitForCondition exceeded maximum attempts (2)",
      );
    });

    it("should include correct maxAttempts in error message", () => {
      const strategy = createWaitStrategy({
        maxAttempts: 15,
        shouldContinuePolling: () => true,
      });

      expect(() => strategy("test", 16)).toThrow(
        "waitForCondition exceeded maximum attempts (15)",
      );
    });
  });

  describe("Edge cases", () => {
    it("should handle attempt number 1 correctly", () => {
      const strategy = createWaitStrategy({
        initialDelay: { seconds: 10 },
        backoffRate: 2,
        jitter: JitterStrategy.NONE,
        shouldContinuePolling: () => true,
      });

      const decision = strategy("test", 1);

      if (decision.shouldContinue) {
        // First attempt should use initialDelaySeconds without backoff
        expect(decision.delay.seconds).toBe(10);
      }
    });

    it("should handle zero jitter", () => {
      const strategy = createWaitStrategy({
        initialDelay: { seconds: 5 },
        jitter: JitterStrategy.NONE,
        shouldContinuePolling: () => true,
      });

      const decision = strategy("test", 1);

      if (decision.shouldContinue) {
        expect(decision.delay.seconds).toBe(5);
      }
    });

    it("should handle backoffRate of 1 (no exponential growth)", () => {
      const strategy = createWaitStrategy({
        initialDelay: { seconds: 10 },
        backoffRate: 1,
        jitter: JitterStrategy.NONE,
        shouldContinuePolling: () => true,
      });

      const decision1 = strategy("test", 1);
      const decision2 = strategy("test", 2);
      const decision3 = strategy("test", 3);

      if (
        decision1.shouldContinue &&
        decision2.shouldContinue &&
        decision3.shouldContinue
      ) {
        // All should be the same with backoffRate = 1
        expect(decision1.delay.seconds).toBe(10);
        expect(decision2.delay.seconds).toBe(10);
        expect(decision3.delay.seconds).toBe(10);
      }
    });

    it("should round delay to nearest integer", () => {
      const strategy = createWaitStrategy({
        initialDelay: { seconds: 1.7 },
        backoffRate: 1.5,
        jitter: JitterStrategy.NONE,
        shouldContinuePolling: () => true,
      });

      const decision = strategy("test", 2);

      if (decision.shouldContinue) {
        // 1.7 * 1.5^1 = 2.55, should be rounded
        expect(decision.delay.seconds).toBe(3);
        expect(Number.isInteger(decision.delay.seconds)).toBe(true);
      }
    });
  });

  describe("Real-world scenarios", () => {
    it("should work for CloudFormation stack polling", () => {
      interface StackStatus {
        status: string;
        stackId: string;
      }

      const strategy = createWaitStrategy({
        maxAttempts: 30,
        initialDelay: { seconds: 15 },
        maxDelay: { seconds: 60 },
        backoffRate: 1.2,
        shouldContinuePolling: (result: StackStatus) =>
          !["CREATE_COMPLETE", "CREATE_FAILED"].includes(result.status),
      });

      // Stack still creating
      const pendingDecision = strategy(
        { status: "CREATE_IN_PROGRESS", stackId: "stack-123" },
        5,
      );
      expect(pendingDecision.shouldContinue).toBe(true);

      // Stack creation complete
      const completeDecision = strategy(
        { status: "CREATE_COMPLETE", stackId: "stack-123" },
        5,
      );
      expect(completeDecision.shouldContinue).toBe(false);

      // Stack creation failed
      const failedDecision = strategy(
        { status: "CREATE_FAILED", stackId: "stack-123" },
        5,
      );
      expect(failedDecision.shouldContinue).toBe(false);
    });

    it("should work for job status polling", () => {
      interface JobStatus {
        jobId: string;
        status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
        progress: number;
      }

      const strategy = createWaitStrategy({
        maxAttempts: 100,
        initialDelay: { seconds: 5 },
        maxDelay: { seconds: 30 },
        shouldContinuePolling: (result: JobStatus) =>
          !["COMPLETED", "FAILED"].includes(result.status),
      });

      // Job still running
      const runningDecision = strategy(
        { jobId: "job-456", status: "RUNNING", progress: 50 },
        10,
      );
      expect(runningDecision.shouldContinue).toBe(true);

      // Job completed
      const completedDecision = strategy(
        { jobId: "job-456", status: "COMPLETED", progress: 100 },
        10,
      );
      expect(completedDecision.shouldContinue).toBe(false);
    });

    it("should work for simple boolean conditions", () => {
      const strategy = createWaitStrategy({
        maxAttempts: 5,
        initialDelay: { seconds: 2 },
        shouldContinuePolling: (isReady: boolean) => !isReady,
      });

      expect(strategy(false, 1).shouldContinue).toBe(true);
      expect(strategy(true, 1).shouldContinue).toBe(false);
    });
  });
});
