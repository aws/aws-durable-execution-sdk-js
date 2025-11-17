import { Scheduler } from "../scheduler";

describe("Scheduler", () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("initial state", () => {
    it("should not have any scheduled function initially", () => {
      expect(scheduler.hasScheduledFunction()).toBe(false);
    });
  });

  describe("scheduleFunction", () => {
    it("should set hasScheduledFunction to true when a function is scheduled", () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      scheduler.scheduleFunction(mockFn, 1, mockOnError);

      expect(scheduler.hasScheduledFunction()).toBe(true);
    });

    it("should execute the scheduled function after the specified delay", async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      scheduler.scheduleFunction(mockFn, 2000, mockOnError);

      expect(mockFn).not.toHaveBeenCalled();

      // Fast-forward time by 2 seconds
      jest.advanceTimersByTime(2000);

      // Allow the promise to resolve
      await Promise.resolve();

      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should set hasScheduledFunction to false after the function executes", async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      scheduler.scheduleFunction(mockFn, 1000, mockOnError);
      expect(scheduler.hasScheduledFunction()).toBe(true);

      // Fast-forward time by 1 second
      jest.advanceTimersByTime(1000);

      // Allow the promise to resolve
      await Promise.resolve();

      expect(scheduler.hasScheduledFunction()).toBe(false);
    });

    it("should call onError when the scheduled function throws an error", async () => {
      const error = new Error("Test error");
      const mockFn = jest.fn().mockRejectedValue(error);
      const mockOnError = jest.fn();

      scheduler.scheduleFunction(mockFn, 1000, mockOnError);

      // Fast-forward time by 1 second
      jest.advanceTimersByTime(1000);

      // Allow the promise to resolve/reject
      await Promise.resolve();

      expect(mockOnError).toHaveBeenCalledWith(error);
    });

    it("should handle multiple scheduled functions independently", async () => {
      const mockFn1 = jest.fn().mockResolvedValue(undefined);
      const mockFn2 = jest.fn().mockResolvedValue(undefined);
      const mockOnError1 = jest.fn();
      const mockOnError2 = jest.fn();

      scheduler.scheduleFunction(mockFn1, 1000, mockOnError1);
      scheduler.scheduleFunction(mockFn2, 2000, mockOnError2);

      // Fast-forward by 1 second - only first function should execute
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(mockFn1).toHaveBeenCalledTimes(1);
      expect(mockFn2).not.toHaveBeenCalled();

      // Fast-forward by another second - second function should execute
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(mockFn2).toHaveBeenCalledTimes(1);
    });

    it("should convert delay from seconds to milliseconds correctly", async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      scheduler.scheduleFunction(mockFn, 500, mockOnError);

      // Fast-forward by 499ms - function should not execute yet
      jest.advanceTimersByTime(499);
      await Promise.resolve();
      expect(mockFn).not.toHaveBeenCalled();

      // Fast-forward by 1ms more (total 500ms) - function should execute
      jest.advanceTimersByTime(1);
      await Promise.resolve();
      expect(mockFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("waitForScheduledFunction", () => {
    it("should resolve when a function is scheduled", async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      const waitPromise = scheduler.waitForScheduledFunction();

      // Schedule a function which should resolve the wait promise
      scheduler.scheduleFunction(mockFn, 1000, mockOnError);

      // Wait should now resolve
      await waitPromise;
      expect(true).toBe(true); // If we get here, the promise resolved successfully
    });

    it("should create a new promise after each wait", async () => {
      const mockFn1 = jest.fn().mockResolvedValue(undefined);
      const mockFn2 = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      // First wait
      const waitPromise1 = scheduler.waitForScheduledFunction();
      scheduler.scheduleFunction(mockFn1, 1000, mockOnError);
      await waitPromise1;

      // Second wait should be a new promise that doesn't resolve immediately
      const waitPromise2 = scheduler.waitForScheduledFunction();

      // Verify that waitPromise2 is a different promise from waitPromise1
      expect(waitPromise2).not.toBe(waitPromise1);

      // Schedule another function which should resolve the second wait
      scheduler.scheduleFunction(mockFn2, 1, mockOnError);
      await waitPromise2;
      expect(true).toBe(true); // If we get here, the second promise resolved successfully
    });

    it("should handle multiple concurrent waits", async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      const waitPromise1 = scheduler.waitForScheduledFunction();
      const waitPromise2 = scheduler.waitForScheduledFunction();

      // Each call creates a different promise, but the first one should resolve immediately
      // when a function is scheduled, and the second one waits for the next scheduling
      expect(waitPromise1).not.toBe(waitPromise2);

      // Schedule a function which should resolve the first wait
      scheduler.scheduleFunction(mockFn, 1000, mockOnError);

      // First promise should resolve
      await waitPromise1;

      // Schedule another function which should resolve the second wait
      const mockFn2 = jest.fn().mockResolvedValue(undefined);
      scheduler.scheduleFunction(mockFn2, 1000, mockOnError);

      await waitPromise2;
      expect(true).toBe(true); // If we get here, both promises resolved successfully
    });
  });

  describe("flushTimers", () => {
    it("should clear all running timers and prevent functions from executing", async () => {
      const mockFn1 = jest.fn().mockResolvedValue(undefined);
      const mockFn2 = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      // Schedule multiple functions
      scheduler.scheduleFunction(mockFn1, 1000, mockOnError);
      scheduler.scheduleFunction(mockFn2, 2000, mockOnError);

      expect(scheduler.hasScheduledFunction()).toBe(true);

      // Flush all timers
      scheduler.flushTimers();

      // Fast-forward time - functions should not execute
      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      expect(mockFn1).not.toHaveBeenCalled();
      expect(mockFn2).not.toHaveBeenCalled();
      expect(mockOnError).not.toHaveBeenCalled();
    });

    it("should reset hasScheduledFunction flag to false", () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      scheduler.scheduleFunction(mockFn, 1000, mockOnError);
      expect(scheduler.hasScheduledFunction()).toBe(true);

      scheduler.flushTimers();
      expect(scheduler.hasScheduledFunction()).toBe(false);
    });

    it("should handle flushing when no timers are running", () => {
      expect(scheduler.hasScheduledFunction()).toBe(false);

      // Should not throw an error
      expect(() => {
        scheduler.flushTimers();
      }).not.toThrow();
      expect(scheduler.hasScheduledFunction()).toBe(false);
    });

    it("should allow scheduling new functions after flushing", async () => {
      const mockFn1 = jest.fn().mockResolvedValue(undefined);
      const mockFn2 = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      // Schedule and flush
      scheduler.scheduleFunction(mockFn1, 1000, mockOnError);
      scheduler.flushTimers();

      // Schedule new function after flush
      scheduler.scheduleFunction(mockFn2, 1000, mockOnError);
      expect(scheduler.hasScheduledFunction()).toBe(true);

      // New function should execute normally
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(mockFn1).not.toHaveBeenCalled(); // First function was flushed
      expect(mockFn2).toHaveBeenCalledTimes(1); // Second function executed
      expect(scheduler.hasScheduledFunction()).toBe(false);
    });

    it("should handle flushing timers that would have thrown errors", async () => {
      const error = new Error("Test error");
      const mockFn = jest.fn().mockRejectedValue(error);
      const mockOnError = jest.fn();

      scheduler.scheduleFunction(mockFn, 1000, mockOnError);
      scheduler.flushTimers();

      // Advance time - error handler should not be called
      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      expect(mockFn).not.toHaveBeenCalled();
      expect(mockOnError).not.toHaveBeenCalled();
    });
  });

  describe("integration scenarios", () => {
    it("should handle scheduling while waiting", async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      const waitPromise = scheduler.waitForScheduledFunction();

      // Schedule function while waiting
      scheduler.scheduleFunction(mockFn, 1000, mockOnError);

      // Wait should resolve
      await waitPromise;
      expect(scheduler.hasScheduledFunction()).toBe(true);

      // Function should execute after delay
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(mockFn).toHaveBeenCalled();
      expect(scheduler.hasScheduledFunction()).toBe(false);
    });

    it("should maintain correct state through multiple schedule cycles", async () => {
      const mockFn1 = jest.fn().mockResolvedValue(undefined);
      const mockFn2 = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      // First cycle
      expect(scheduler.hasScheduledFunction()).toBe(false);

      scheduler.scheduleFunction(mockFn1, 1000, mockOnError);
      expect(scheduler.hasScheduledFunction()).toBe(true);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(scheduler.hasScheduledFunction()).toBe(false);

      // Second cycle
      scheduler.scheduleFunction(mockFn2, 1000, mockOnError);
      expect(scheduler.hasScheduledFunction()).toBe(true);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(scheduler.hasScheduledFunction()).toBe(false);

      expect(mockFn1).toHaveBeenCalledTimes(1);
      expect(mockFn2).toHaveBeenCalledTimes(1);
    });

    it("should handle errors without affecting scheduler state", async () => {
      const error = new Error("Test error");
      const mockFn = jest.fn().mockRejectedValue(error);
      const mockOnError = jest.fn();

      scheduler.scheduleFunction(mockFn, 1000, mockOnError);
      expect(scheduler.hasScheduledFunction()).toBe(true);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(scheduler.hasScheduledFunction()).toBe(false);
      expect(mockOnError).toHaveBeenCalledWith(error);

      // Scheduler should still work for next function
      const mockFn2 = jest.fn().mockResolvedValue(undefined);
      scheduler.scheduleFunction(mockFn2, 1000, mockOnError);
      expect(scheduler.hasScheduledFunction()).toBe(true);
    });
  });
});
