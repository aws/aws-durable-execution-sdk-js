import { QueueScheduler } from "../queue-scheduler";

describe("QueueScheduler", () => {
  let scheduler: QueueScheduler;

  beforeEach(() => {
    scheduler = new QueueScheduler();
  });

  describe("initial state", () => {
    it("should not have any scheduled function initially", () => {
      expect(scheduler.hasScheduledFunction()).toBe(false);
    });
  });

  describe("sequential execution", () => {
    it("should execute functions sequentially, not concurrently", async () => {
      const executionOrder: number[] = [];
      let runningCount = 0;
      let maxConcurrency = 0;

      const createAsyncFunction = (id: number, delay: number) => {
        return async () => {
          runningCount++;
          maxConcurrency = Math.max(maxConcurrency, runningCount);
          executionOrder.push(id);

          // Simulate async work
          await new Promise((resolve) => setTimeout(resolve, delay));

          runningCount--;
        };
      };

      const mockOnError = jest.fn();

      // Schedule multiple functions with different delays
      scheduler.scheduleFunction(createAsyncFunction(1, 50), mockOnError);
      scheduler.scheduleFunction(createAsyncFunction(2, 30), mockOnError);
      scheduler.scheduleFunction(createAsyncFunction(3, 20), mockOnError);

      // Wait for all functions to complete
      await scheduler.waitForCompletion();

      // Verify sequential execution
      expect(executionOrder).toEqual([1, 2, 3]);
      expect(maxConcurrency).toBe(1); // Never more than 1 function running
      expect(mockOnError).not.toHaveBeenCalled();
    });

    it("should handle errors in one function without blocking subsequent functions", async () => {
      const executionOrder: number[] = [];
      const errors: unknown[] = [];

      const createAsyncFunction = (id: number, shouldThrow = false) => {
        // eslint-disable-next-line @typescript-eslint/require-await
        return async () => {
          executionOrder.push(id);
          if (shouldThrow) {
            throw new Error(`Error from function ${id}`);
          }
        };
      };

      const mockOnError = jest.fn((err: unknown) => {
        errors.push(err);
      });

      // Schedule functions where the middle one throws an error
      scheduler.scheduleFunction(createAsyncFunction(1), mockOnError);
      scheduler.scheduleFunction(createAsyncFunction(2, true), mockOnError);
      scheduler.scheduleFunction(createAsyncFunction(3), mockOnError);

      // Wait for all functions to complete
      await scheduler.waitForCompletion();

      // Verify all functions executed in order
      expect(executionOrder).toEqual([1, 2, 3]);
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe("Error from function 2");
      expect(mockOnError).toHaveBeenCalledTimes(1);
    });
  });

  describe("queue management", () => {
    it("should allow scheduling new functions while processing queue", async () => {
      const executionOrder: number[] = [];
      let secondBatchScheduled = false;

      const createFunction = (id: number) => {
        return async () => {
          executionOrder.push(id);
          // Schedule more functions during execution of the first batch
          if (id === 2 && !secondBatchScheduled) {
            secondBatchScheduled = true;
            scheduler.scheduleFunction(createFunction(4), jest.fn());
            scheduler.scheduleFunction(createFunction(5), jest.fn());
          }
          // Small delay to make execution observable
          await new Promise((resolve) => setTimeout(resolve, 10));
        };
      };

      const mockOnError = jest.fn();

      // Schedule initial batch
      scheduler.scheduleFunction(createFunction(1), mockOnError);
      scheduler.scheduleFunction(createFunction(2), mockOnError);
      scheduler.scheduleFunction(createFunction(3), mockOnError);

      // Wait for all functions to complete
      await scheduler.waitForCompletion();

      // Verify execution order
      expect(executionOrder).toEqual([1, 2, 3, 4, 5]);
      expect(mockOnError).not.toHaveBeenCalled();
    });
  });

  describe("updateCheckpoint functionality", () => {
    it("should execute updateCheckpoint before startInvocation", async () => {
      const executionOrder: string[] = [];
      const mockFn = jest.fn().mockImplementation(() => {
        executionOrder.push("startInvocation");
      });
      const mockUpdateCheckpoint = jest.fn().mockImplementation(() => {
        executionOrder.push("updateCheckpoint");
        return Promise.resolve();
      });
      const mockOnError = jest.fn();

      scheduler.scheduleFunction(
        mockFn,
        mockOnError,
        undefined,
        mockUpdateCheckpoint,
      );

      // Wait for execution to complete
      await scheduler.waitForCompletion();

      expect(executionOrder).toEqual(["updateCheckpoint", "startInvocation"]);
      expect(mockUpdateCheckpoint).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockOnError).not.toHaveBeenCalled();
    });

    it("should call onError when updateCheckpoint throws an error", async () => {
      const checkpointError = new Error("Checkpoint error");
      const mockFn = jest.fn();
      const mockUpdateCheckpoint = jest.fn().mockRejectedValue(checkpointError);
      const mockOnError = jest.fn();

      scheduler.scheduleFunction(
        mockFn,
        mockOnError,
        undefined,
        mockUpdateCheckpoint,
      );

      // Wait for error handling to complete
      await scheduler.waitForCompletion();

      expect(mockOnError).toHaveBeenCalledWith(checkpointError);
      expect(mockFn).not.toHaveBeenCalled();
    });

    it("should work correctly when updateCheckpoint is not provided", async () => {
      const mockFn = jest.fn();
      const mockOnError = jest.fn();

      scheduler.scheduleFunction(mockFn, mockOnError);

      // Wait for execution to complete
      await scheduler.waitForCompletion();

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockOnError).not.toHaveBeenCalled();
    });
  });

  describe("timestamp parameter handling", () => {
    it("should ignore timestamp parameter and execute functions in queue order", async () => {
      const executionOrder: number[] = [];

      const createFunction = (id: number) => {
        return () => {
          executionOrder.push(id);
          return Promise.resolve();
        };
      };

      const mockOnError = jest.fn();

      // Schedule functions with timestamps (should be ignored)
      const futureDate = new Date(Date.now() + 10000); // 10 seconds in future
      const pastDate = new Date(Date.now() - 10000); // 10 seconds in past

      scheduler.scheduleFunction(createFunction(1), mockOnError, futureDate);
      scheduler.scheduleFunction(createFunction(2), mockOnError, pastDate);
      scheduler.scheduleFunction(createFunction(3), mockOnError, new Date());

      // Wait for execution to complete
      await scheduler.waitForCompletion();

      // Should execute in queue order, not timestamp order
      expect(executionOrder).toEqual([1, 2, 3]);
    });
  });

  describe("hasScheduledFunction state management", () => {
    it("should return true when functions are queued", () => {
      const mockFn = jest.fn();
      const mockOnError = jest.fn();

      scheduler.scheduleFunction(mockFn, mockOnError);
      expect(scheduler.hasScheduledFunction()).toBe(true);
    });

    it("should return true while processing queue", async () => {
      const mockFn = jest.fn().mockImplementation(async () => {
        // Function is currently executing
        expect(scheduler.hasScheduledFunction()).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const mockOnError = jest.fn();

      scheduler.scheduleFunction(mockFn, mockOnError);

      // Wait for execution to complete
      await scheduler.waitForCompletion();

      expect(mockFn).toHaveBeenCalled();
    });

    it("should return false after all functions complete", async () => {
      const mockFn = jest.fn();
      const mockOnError = jest.fn();

      scheduler.scheduleFunction(mockFn, mockOnError);

      // Wait for execution to complete
      await scheduler.waitForCompletion();

      expect(scheduler.hasScheduledFunction()).toBe(false);
    });
  });

  describe("flushTimers edge cases", () => {
    it("should handle flushing when no functions are queued", () => {
      expect(scheduler.hasScheduledFunction()).toBe(false);

      // Should not throw an error
      expect(() => {
        scheduler.flushTimers();
      }).not.toThrow();

      expect(scheduler.hasScheduledFunction()).toBe(false);
    });

    it("should not cause unhandled rejection when updateCheckpoint fails and queue is flushed before processing", async () => {
      const checkpointError = new Error("Checkpoint error");
      const mockFn = jest.fn();
      const mockUpdateCheckpoint = jest.fn().mockRejectedValue(checkpointError);
      const mockOnError = jest.fn();

      // Schedule function with failing updateCheckpoint
      scheduler.scheduleFunction(
        mockFn,
        mockOnError,
        undefined,
        mockUpdateCheckpoint,
      );

      // Immediately flush before the queue can be processed
      scheduler.flushTimers();

      // Wait a bit to ensure any pending promises settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should call onError even if the item was flushed
      expect(mockOnError).toHaveBeenCalledWith(checkpointError);
      expect(mockFn).not.toHaveBeenCalled();
      expect(mockUpdateCheckpoint).toHaveBeenCalledTimes(1);
      expect(scheduler.hasScheduledFunction()).toBe(false);

      // No unhandled rejection should occur
    });

    it("should stop processing and clear queue when flushed during execution", async () => {
      const executionOrder: number[] = [];
      let flushCalled = false;

      const createFunction = (id: number) => {
        return async () => {
          executionOrder.push(id);

          // Flush after first function starts executing
          if (id === 1 && !flushCalled) {
            flushCalled = true;
            scheduler.flushTimers();
          }

          await new Promise((resolve) => setTimeout(resolve, 10));
        };
      };

      const mockOnError = jest.fn();

      // Schedule multiple functions
      scheduler.scheduleFunction(createFunction(1), mockOnError);
      scheduler.scheduleFunction(createFunction(2), mockOnError);
      scheduler.scheduleFunction(createFunction(3), mockOnError);

      // Wait for execution to complete
      await scheduler.waitForCompletion();

      // Only the first function should have executed before flush
      expect(executionOrder).toEqual([1]);
      expect(scheduler.hasScheduledFunction()).toBe(false);
    });

    it("should allow scheduling new functions after flushing", async () => {
      const executionOrder: number[] = [];

      const createFunction = (id: number) => {
        return () => {
          executionOrder.push(id);
          return Promise.resolve();
        };
      };

      const mockOnError = jest.fn();

      // Schedule and flush
      scheduler.scheduleFunction(createFunction(1), mockOnError);
      scheduler.scheduleFunction(createFunction(2), mockOnError);
      scheduler.flushTimers();

      // Schedule new function after flush
      scheduler.scheduleFunction(createFunction(3), mockOnError);

      // Wait for execution to complete
      await scheduler.waitForCompletion();

      // Only the function scheduled after flush should execute
      expect(executionOrder).toEqual([3]);
    });
  });

  describe("interface compliance", () => {
    it("should implement all Scheduler interface methods", () => {
      expect(typeof scheduler.scheduleFunction).toBe("function");
      expect(typeof scheduler.flushTimers).toBe("function");
      expect(typeof scheduler.hasScheduledFunction).toBe("function");
    });

    it("should clear queue when flushTimers is called", async () => {
      const executionOrder: number[] = [];

      const createFunction = (id: number) => {
        return async () => {
          executionOrder.push(id);
          await new Promise((resolve) => setTimeout(resolve, 50));
        };
      };

      const mockOnError = jest.fn();

      // Schedule functions
      scheduler.scheduleFunction(createFunction(1), mockOnError);
      scheduler.scheduleFunction(createFunction(2), mockOnError);
      scheduler.scheduleFunction(createFunction(3), mockOnError);

      // Immediately flush before they can execute
      scheduler.flushTimers();

      // Wait a bit to ensure no functions execute
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(executionOrder).toEqual([]);
      expect(scheduler.hasScheduledFunction()).toBe(false);
    });
  });
});
