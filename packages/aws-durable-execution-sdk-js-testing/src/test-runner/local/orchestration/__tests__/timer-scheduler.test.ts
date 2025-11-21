import { Scheduler } from "../scheduler";
import { TimerScheduler } from "../timer-scheduler";

describe("TimerScheduler", () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new TimerScheduler();
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

      const timestamp = new Date();
      timestamp.setMilliseconds(new Date().getMilliseconds() + 1);
      scheduler.scheduleFunction(mockFn, mockOnError, timestamp);

      expect(scheduler.hasScheduledFunction()).toBe(true);
    });

    it("should use current time as default timestamp", async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      // Schedule function without timestamp parameter
      scheduler.scheduleFunction(mockFn, mockOnError);

      // Should execute immediately since default is new Date()
      await jest.advanceTimersByTimeAsync(0);

      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should execute immediately for past timestamps", async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      const pastTimestamp = new Date();
      pastTimestamp.setSeconds(pastTimestamp.getSeconds() - 10); // 10 seconds ago
      scheduler.scheduleFunction(mockFn, mockOnError, pastTimestamp);

      // Should execute immediately (0ms delay)
      await jest.advanceTimersByTimeAsync(0);

      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should handle zero delay correctly", async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      const currentTime = new Date();
      scheduler.scheduleFunction(mockFn, mockOnError, currentTime);

      await jest.advanceTimersByTimeAsync(0);

      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should execute updateCheckpoint before startInvocation", async () => {
      const executionOrder: string[] = [];
      const mockFn = jest.fn().mockImplementation(() => {
        executionOrder.push("startInvocation");
        return Promise.resolve();
      });
      const mockUpdateCheckpoint = jest.fn().mockImplementation(() => {
        executionOrder.push("updateCheckpoint");
        return Promise.resolve();
      });
      const mockOnError = jest.fn();

      const timestamp = new Date();
      timestamp.setSeconds(timestamp.getSeconds() + 1);
      scheduler.scheduleFunction(
        mockFn,
        mockOnError,
        timestamp,
        mockUpdateCheckpoint,
      );

      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(executionOrder).toEqual(["updateCheckpoint", "startInvocation"]);
    });

    it("should call onError when updateCheckpoint throws an error", async () => {
      const checkpointError = new Error("Checkpoint error");
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockUpdateCheckpoint = jest.fn().mockRejectedValue(checkpointError);
      const mockOnError = jest.fn();

      const timestamp = new Date();
      timestamp.setSeconds(timestamp.getSeconds() + 1);
      scheduler.scheduleFunction(
        mockFn,
        mockOnError,
        timestamp,
        mockUpdateCheckpoint,
      );

      await jest.advanceTimersByTimeAsync(1000);

      expect(mockOnError).toHaveBeenCalledWith(checkpointError);
      expect(mockFn).not.toHaveBeenCalled();
    });

    it("should not execute startInvocation when updateCheckpoint fails", async () => {
      const checkpointError = new Error("Checkpoint error");
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockUpdateCheckpoint = jest.fn().mockRejectedValue(checkpointError);
      const mockOnError = jest.fn();

      const timestamp = new Date();
      timestamp.setSeconds(timestamp.getSeconds() + 1);
      scheduler.scheduleFunction(
        mockFn,
        mockOnError,
        timestamp,
        mockUpdateCheckpoint,
      );

      await jest.advanceTimersByTimeAsync(1000);

      expect(mockUpdateCheckpoint).toHaveBeenCalledTimes(1);
      expect(mockFn).not.toHaveBeenCalled();
      expect(mockOnError).toHaveBeenCalledWith(checkpointError);
    });

    it("should execute the scheduled function after the specified delay", async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      const timestamp = new Date();
      timestamp.setSeconds(new Date().getSeconds() + 2);
      scheduler.scheduleFunction(mockFn, mockOnError, timestamp);

      expect(mockFn).not.toHaveBeenCalled();

      // Fast-forward time by 2 seconds
      await jest.advanceTimersByTimeAsync(2000);

      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should set hasScheduledFunction to false after the function executes", async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      const timestamp = new Date();
      timestamp.setSeconds(new Date().getSeconds() + 1);
      scheduler.scheduleFunction(mockFn, mockOnError, timestamp);
      expect(scheduler.hasScheduledFunction()).toBe(true);

      // Fast-forward time by 1 second
      await jest.advanceTimersByTimeAsync(1000);

      expect(scheduler.hasScheduledFunction()).toBe(false);
    });

    it("should call onError when the scheduled function throws an error", async () => {
      const error = new Error("Test error");
      const mockFn = jest.fn().mockRejectedValue(error);
      const mockOnError = jest.fn();

      const timestamp = new Date();
      timestamp.setSeconds(new Date().getSeconds() + 1);
      scheduler.scheduleFunction(mockFn, mockOnError, timestamp);

      // Fast-forward time by 1 second
      await jest.advanceTimersByTimeAsync(1000);

      expect(mockOnError).toHaveBeenCalledWith(error);
    });

    it("should handle multiple scheduled functions independently", async () => {
      const mockFn1 = jest.fn().mockResolvedValue(undefined);
      const mockFn2 = jest.fn().mockResolvedValue(undefined);
      const mockOnError1 = jest.fn();
      const mockOnError2 = jest.fn();

      const timestamp1 = new Date();
      timestamp1.setSeconds(new Date().getSeconds() + 1);
      const timestamp2 = new Date();
      timestamp2.setSeconds(new Date().getSeconds() + 2);
      scheduler.scheduleFunction(mockFn1, mockOnError1, timestamp1);
      scheduler.scheduleFunction(mockFn2, mockOnError2, timestamp2);

      // Fast-forward by 1 second - only first function should execute
      await jest.advanceTimersByTimeAsync(1000);

      expect(mockFn1).toHaveBeenCalledTimes(1);
      expect(mockFn2).not.toHaveBeenCalled();

      // Fast-forward by another second - second function should execute
      await jest.advanceTimersByTimeAsync(1000);

      expect(mockFn2).toHaveBeenCalledTimes(1);
    });

    it("should convert delay from seconds to milliseconds correctly", async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      const timestamp = new Date();
      timestamp.setMilliseconds(new Date().getMilliseconds() + 500);
      scheduler.scheduleFunction(mockFn, mockOnError, timestamp);

      // Fast-forward by 499ms - function should not execute yet
      await jest.advanceTimersByTimeAsync(499);
      expect(mockFn).not.toHaveBeenCalled();

      // Fast-forward by 1ms more (total 500ms) - function should execute
      await jest.advanceTimersByTimeAsync(1);
      expect(mockFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("flushTimers", () => {
    it("should clear all running timers and prevent functions from executing", async () => {
      const mockFn1 = jest.fn().mockResolvedValue(undefined);
      const mockFn2 = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      // Schedule multiple functions
      const timestamp1 = new Date();
      timestamp1.setSeconds(new Date().getSeconds() + 1);
      const timestamp2 = new Date();
      timestamp2.setSeconds(new Date().getSeconds() + 2);
      scheduler.scheduleFunction(mockFn1, mockOnError, timestamp1);
      scheduler.scheduleFunction(mockFn2, mockOnError, timestamp2);

      expect(scheduler.hasScheduledFunction()).toBe(true);

      // Flush all timers
      scheduler.flushTimers();

      // Fast-forward time - functions should not execute
      await jest.advanceTimersByTimeAsync(3000);

      expect(mockFn1).not.toHaveBeenCalled();
      expect(mockFn2).not.toHaveBeenCalled();
      expect(mockOnError).not.toHaveBeenCalled();
    });

    it("should reset hasScheduledFunction flag to false", () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      const timestamp = new Date();
      timestamp.setSeconds(new Date().getSeconds() + 1);
      scheduler.scheduleFunction(mockFn, mockOnError, timestamp);
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
      const timestamp1 = new Date();
      timestamp1.setSeconds(new Date().getSeconds() + 1);
      scheduler.scheduleFunction(mockFn1, mockOnError, timestamp1);
      scheduler.flushTimers();

      // Schedule new function after flush
      const timestamp2 = new Date();
      timestamp2.setSeconds(new Date().getSeconds() + 1);
      scheduler.scheduleFunction(mockFn2, mockOnError, timestamp2);
      expect(scheduler.hasScheduledFunction()).toBe(true);

      // New function should execute normally
      await jest.advanceTimersByTimeAsync(1000);

      expect(mockFn1).not.toHaveBeenCalled(); // First function was flushed
      expect(mockFn2).toHaveBeenCalledTimes(1); // Second function executed
      expect(scheduler.hasScheduledFunction()).toBe(false);
    });

    it("should handle flushing timers that would have thrown errors", async () => {
      const error = new Error("Test error");
      const mockFn = jest.fn().mockRejectedValue(error);
      const mockOnError = jest.fn();

      const timestamp = new Date();
      timestamp.setSeconds(new Date().getSeconds() + 1);
      scheduler.scheduleFunction(mockFn, mockOnError, timestamp);
      scheduler.flushTimers();

      // Advance time - error handler should not be called
      await jest.advanceTimersByTimeAsync(2000);

      expect(mockFn).not.toHaveBeenCalled();
      expect(mockOnError).not.toHaveBeenCalled();
    });
  });

  describe("updateCheckpoint functionality", () => {
    it("should work correctly when updateCheckpoint is not provided", async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      const timestamp = new Date();
      timestamp.setSeconds(timestamp.getSeconds() + 1);
      scheduler.scheduleFunction(mockFn, mockOnError, timestamp);

      await jest.advanceTimersByTimeAsync(1000);

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockOnError).not.toHaveBeenCalled();
    });

    it("should handle updateCheckpoint returning undefined", async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const mockUpdateCheckpoint = jest.fn().mockResolvedValue(undefined);
      const mockOnError = jest.fn();

      const timestamp = new Date();
      timestamp.setSeconds(timestamp.getSeconds() + 1);
      scheduler.scheduleFunction(
        mockFn,
        mockOnError,
        timestamp,
        mockUpdateCheckpoint,
      );

      await jest.advanceTimersByTimeAsync(1000);

      expect(mockUpdateCheckpoint).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockOnError).not.toHaveBeenCalled();
    });
  });
});
