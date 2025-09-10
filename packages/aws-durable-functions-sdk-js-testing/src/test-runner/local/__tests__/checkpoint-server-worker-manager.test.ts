import { CheckpointServerWorkerManager } from "../checkpoint-server-worker-manager";
import { Worker } from "worker_threads";
import {
  WorkerResponseType,
  WorkerCommandType,
  ServerStartedData,
  WorkerResponse,
} from "../../../checkpoint-server/worker/worker-message-types";
import * as fs from "fs/promises";
import * as path from "path";

// Mock worker_threads
jest.mock("worker_threads");
jest.mock("fs/promises");

const MockWorker = Worker as jest.MockedClass<typeof Worker>;
const mockFs = fs as jest.Mocked<typeof fs>;

function flushPromises() {
  return new Promise((resolve) =>
    jest.requireActual<typeof import("timers")>("timers").setImmediate(resolve)
  );
}

describe("CheckpointServerWorkerManager", () => {
  let mockWorker: jest.Mocked<Worker>;
  let manager: CheckpointServerWorkerManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Mock console.warn to avoid noise in test output
    console.warn = jest.fn();

    // Create a simplified mock worker
    mockWorker = {
      on: jest.fn().mockReturnThis(),
      once: jest.fn().mockReturnThis(),
      addListener: jest.fn().mockReturnThis(),
      removeListener: jest.fn().mockReturnThis(),
      postMessage: jest.fn(),
      terminate: jest.fn().mockResolvedValue(undefined),
      unref: jest.fn(),
    } as unknown as jest.Mocked<Worker>;

    // Mock Worker constructor
    MockWorker.mockImplementation(() => mockWorker);

    // Reset singleton instance before each test
    CheckpointServerWorkerManager.resetInstanceForTesting();
    manager = CheckpointServerWorkerManager.getInstance();
  });

  describe("Singleton Pattern", () => {
    it("should return the same instance across multiple calls", () => {
      const instance1 = CheckpointServerWorkerManager.getInstance();
      const instance2 = CheckpointServerWorkerManager.getInstance();
      const instance3 = CheckpointServerWorkerManager.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
      expect(instance1).toBe(manager);
    });

    it("should maintain singleton across different imports", () => {
      // Reset the instance using the proper test utility
      CheckpointServerWorkerManager.resetInstanceForTesting();

      const instance1 = CheckpointServerWorkerManager.getInstance();
      const instance2 = CheckpointServerWorkerManager.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe("getServerInfo", () => {
    it("should return null initially", () => {
      expect(manager.getServerInfo()).toBeNull();
    });

    it("should return server info after successful setup", async () => {
      const expectedServerData: ServerStartedData = {
        port: 3000,
        url: "http://127.0.0.1:3000",
      };

      // Mock fs.access to return dev path
      mockFs.access.mockResolvedValue(undefined);

      // Mock the message listener to simulate server start response
      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.SERVER_STARTED,
            data: expectedServerData,
          });
        }
        return mockWorker as Worker;
      });

      const result = await manager.setup();

      expect(result).toEqual(expectedServerData);
      expect(manager.getServerInfo()).toEqual(expectedServerData);
    });
  });

  describe("Worker Path Resolution", () => {
    it("should use dev path when index.ts exists", async () => {
      // Mock fs.access to succeed for dev path
      mockFs.access.mockResolvedValue(undefined);

      // Simple mock for successful setup - call listener synchronously
      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.SERVER_STARTED,
            data: { port: 3000, url: "http://127.0.0.1:3000" },
          });
        }
        return mockWorker as Worker;
      });

      await manager.setup();

      // The actual path resolution from CheckpointServerWorkerManager perspective
      // From local/ directory: ../../checkpoint-server/index.ts
      const expectedDevPath = path.resolve(
        __dirname,
        "../../../checkpoint-server/index.ts"
      );

      expect(MockWorker).toHaveBeenCalledWith(expectedDevPath, {
        execArgv: ["--require", "tsx/cjs"],
      });
    });

    it("should fallback to prod path when index.ts does not exist", async () => {
      // Mock fs.access to fail for dev path (file doesn't exist)
      mockFs.access.mockRejectedValue(new Error("File not found"));

      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.SERVER_STARTED,
            data: { port: 3000, url: "http://127.0.0.1:3000" },
          });
        }
        return mockWorker as Worker;
      });

      await manager.setup();

      // The actual path resolution from CheckpointServerWorkerManager perspective
      // From local/ directory: ./checkpoint-server/index.js
      const expectedProdPath = path.resolve(
        __dirname,
        "../checkpoint-server/index.js"
      );

      expect(MockWorker).toHaveBeenCalledWith(expectedProdPath, {
        execArgv: undefined,
      });
    });
  });

  describe("setup", () => {
    beforeEach(() => {
      mockFs.access.mockResolvedValue(undefined); // Default to dev path
    });

    it("should create worker and setup event listeners", async () => {
      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.SERVER_STARTED,
            data: { port: 3000, url: "http://127.0.0.1:3000" },
          });
        }
        return mockWorker as Worker;
      });

      await manager.setup();

      expect(MockWorker).toHaveBeenCalledTimes(1);
      expect(mockWorker.on).toHaveBeenCalledWith("error", expect.any(Function));
      expect(mockWorker.on).toHaveBeenCalledWith("exit", expect.any(Function));
    });

    it("should throw error if worker already running", async () => {
      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.SERVER_STARTED,
            data: { port: 3000, url: "http://127.0.0.1:3000" },
          });
        }
        return mockWorker as Worker;
      });

      // First setup should succeed
      await manager.setup();

      // Second setup should fail
      await expect(manager.setup()).rejects.toThrow(
        "Worker thread is already running"
      );
    });

    it("should handle server startup timeout", async () => {
      jest.useFakeTimers();

      try {
        // Don't trigger the message callback to simulate timeout
        mockWorker.once.mockReturnValue(mockWorker as Worker);
        mockWorker.addListener.mockReturnValue(mockWorker as Worker);

        const setupPromise = manager.setup();

        await flushPromises();
        jest.advanceTimersByTime(4100);

        await expect(setupPromise).rejects.toThrow(
          "Starting the server timed out"
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it("should handle ERROR response from worker", async () => {
      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.ERROR,
            data: { message: "Server failed to start" },
            error: "Server failed to start",
          });
        }
        return mockWorker as Worker;
      });

      await expect(manager.setup()).rejects.toThrow("Server failed to start");
    });

    it("should handle unknown response type", async () => {
      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: unknown) => void)({
            type: "UNKNOWN_TYPE",
          });
        }
        return mockWorker as Worker;
      });

      await expect(manager.setup()).rejects.toThrow(
        "Unknown start response received"
      );
    });
  });

  describe("teardown", () => {
    beforeEach(async () => {
      mockFs.access.mockResolvedValue(undefined);

      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.SERVER_STARTED,
            data: { port: 3000, url: "http://127.0.0.1:3000" },
          });
        }
        return mockWorker as Worker;
      });

      await manager.setup();
      jest.clearAllMocks(); // Clear setup call mocks
    });

    it("should gracefully shutdown worker", async () => {
      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.SERVER_SHUTDOWN,
          });
        }
        return mockWorker as Worker;
      });

      await manager.teardown();

      expect(mockWorker.postMessage).toHaveBeenCalledWith({
        type: WorkerCommandType.SHUTDOWN_SERVER,
      });
      expect(mockWorker.unref).toHaveBeenCalled();
      expect(mockWorker.terminate).not.toHaveBeenCalled();
    });

    it("should handle no worker gracefully", async () => {
      // Create a fresh manager instance for this test
      CheckpointServerWorkerManager.resetInstanceForTesting();
      const freshManager = CheckpointServerWorkerManager.getInstance();

      // Should not throw when called without setup
      await expect(freshManager.teardown()).resolves.toBeUndefined();
    });

    it("should force terminate on shutdown timeout", async () => {
      jest.useFakeTimers();

      // Don't trigger message callback to simulate timeout
      mockWorker.once.mockReturnValue(mockWorker as Worker);

      const teardownPromise = manager.teardown();

      // Advance past SHUTDOWN_TIMEOUT (3000ms)
      jest.advanceTimersByTime(3001);

      await teardownPromise;

      expect(mockWorker.terminate).toHaveBeenCalled();
      expect(mockWorker.unref).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it("should force terminate on shutdown error", async () => {
      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.ERROR,
            data: { message: "Shutdown failed" },
            error: "Shutdown failed",
          });
        }
        return mockWorker as Worker;
      });

      await manager.teardown();

      expect(mockWorker.terminate).toHaveBeenCalled();
      expect(mockWorker.unref).not.toHaveBeenCalled();
    });

    it("should handle worker terminate errors gracefully", async () => {
      mockWorker.terminate.mockRejectedValue(new Error("Terminate failed"));

      jest.useFakeTimers();

      // Don't trigger message callback to force timeout path
      mockWorker.once.mockReturnValue(mockWorker as Worker);

      const teardownPromise = manager.teardown();
      jest.advanceTimersByTime(3001);

      // Should not throw despite terminate error
      await expect(teardownPromise).resolves.toBeUndefined();

      jest.useRealTimers();
    });
  });

  describe("Worker Event Handling", () => {
    beforeEach(() => {
      mockFs.access.mockResolvedValue(undefined);
    });

    it("should handle worker error events", async () => {
      let errorHandler: (err: Error) => void;

      // Capture the error handler
      mockWorker.on.mockImplementation((event, listener) => {
        if (event === "error") {
          errorHandler = listener as (err: Error) => void;
        }
        return mockWorker as Worker;
      });

      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.SERVER_STARTED,
            data: { port: 3000, url: "http://127.0.0.1:3000" },
          });
        }
        return mockWorker as Worker;
      });

      await manager.setup();

      // Simulate worker error
      const testError = new Error("Worker runtime error");
      errorHandler!(testError);

      expect(console.warn).toHaveBeenCalledWith(
        "There was a worker error: ",
        testError
      );
      expect(manager.getServerInfo()).toBeNull(); // Worker should be nullified
    });

    it("should handle worker exit with non-zero code", async () => {
      let exitHandler: (code: number) => void;

      mockWorker.on.mockImplementation((event, listener) => {
        if (event === "exit") {
          exitHandler = listener as (code: number) => void;
        }
        return mockWorker as Worker;
      });

      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.SERVER_STARTED,
            data: { port: 3000, url: "http://127.0.0.1:3000" },
          });
        }
        return mockWorker as Worker;
      });

      await manager.setup();

      // Simulate worker exit with non-zero code
      exitHandler!(1);

      expect(console.warn).toHaveBeenCalledWith("Worker exited with code: 1");
      expect(manager.getServerInfo()).toBeNull(); // Worker should be nullified
    });

    it("should handle worker exit with zero code silently", async () => {
      let exitHandler: (code: number) => void;

      mockWorker.on.mockImplementation((event, listener) => {
        if (event === "exit") {
          exitHandler = listener as (code: number) => void;
        }
        return mockWorker as Worker;
      });

      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.SERVER_STARTED,
            data: { port: 3000, url: "http://127.0.0.1:3000" },
          });
        }
        return mockWorker as Worker;
      });

      await manager.setup();

      // Simulate worker exit with zero code (normal exit)
      exitHandler!(0);

      expect(console.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("Worker exited with code:")
      );
      expect(manager.getServerInfo()).toBeNull(); // Worker should still be nullified
    });
  });

  describe("Edge Cases and Race Conditions", () => {
    beforeEach(() => {
      mockFs.access.mockResolvedValue(undefined);
    });

    it("should handle concurrent setup calls properly", async () => {
      MockWorker.mockImplementation(() => {
        mockWorker.once.mockImplementation((event, listener) => {
          if (event === "message") {
            (listener as (response: WorkerResponse) => void)({
              type: WorkerResponseType.SERVER_STARTED,
              data: { port: 3000, url: "http://127.0.0.1:3000" },
            });
          }
          return mockWorker as Worker;
        });
        return mockWorker;
      });

      // Try to setup concurrently - these should be synchronously rejected
      const setup1 = manager.setup(); // Should succeed
      const setup2 = manager.setup(); // Should fail immediately
      const setup3 = manager.setup(); // Should fail immediately

      // First should succeed
      await expect(setup1).resolves.toBeDefined();

      // Others should fail immediately (not timeout)
      await expect(setup2).rejects.toThrow("Worker thread is already running");
      await expect(setup3).rejects.toThrow("Worker thread is already running");

      // Only one worker should have been created
      expect(MockWorker).toHaveBeenCalledTimes(1);
    });

    it("should handle teardown during setup", async () => {
      jest.useFakeTimers();

      try {
        // Setup that will timeout
        mockWorker.once.mockReturnValue(mockWorker as Worker);
        mockWorker.addListener.mockReturnValue(mockWorker as Worker);

        const setupPromise = manager.setup();

        // Try to teardown while setup is in progress
        const teardownPromise = manager.teardown();

        await flushPromises();

        // Advance time to trigger timeout - advance past both COMMAND_TIMEOUT (4s) and SHUTDOWN_TIMEOUT (3s)
        jest.advanceTimersByTime(6000);

        // Setup should timeout, teardown should handle gracefully
        await expect(setupPromise).rejects.toThrow(
          "Starting the server timed out"
        );
        await expect(teardownPromise).resolves.toBeUndefined();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("Memory and Resource Management", () => {
    it("should clear server info on worker error", async () => {
      mockFs.access.mockResolvedValue(undefined);

      let errorHandler: (err: Error) => void;
      mockWorker.on.mockImplementation((event, listener) => {
        if (event === "error") {
          errorHandler = listener as (err: Error) => void;
        }
        return mockWorker as Worker;
      });

      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.SERVER_STARTED,
            data: { port: 3000, url: "http://127.0.0.1:3000" },
          });
        }
        return mockWorker as Worker;
      });

      await manager.setup();
      expect(manager.getServerInfo()).not.toBeNull();

      // Simulate worker error
      errorHandler!(new Error("Worker error"));

      expect(manager.getServerInfo()).toBeNull();
    });

    it("should clear server info on worker exit", async () => {
      mockFs.access.mockResolvedValue(undefined);

      let exitHandler: (code: number) => void;
      mockWorker.on.mockImplementation((event, listener) => {
        if (event === "exit") {
          exitHandler = listener as (code: number) => void;
        }
        return mockWorker as Worker;
      });

      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          // Call listener immediately and synchronously
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.SERVER_STARTED,
            data: { port: 3000, url: "http://127.0.0.1:3000" },
          });
        }
        return mockWorker as Worker;
      });

      await manager.setup();
      expect(manager.getServerInfo()).not.toBeNull();

      // Simulate worker exit
      exitHandler!(0);

      expect(manager.getServerInfo()).toBeNull();
    });
  });

  describe("Startup/shutdown error handling", () => {
    beforeEach(() => {
      mockFs.access.mockResolvedValue(undefined);
    });

    it("should handle worker error during startup", async () => {
      let errorHandler: ((err: Error) => void) | undefined;

      // Capture the error handler during setup
      mockWorker.addListener.mockImplementation((event, listener) => {
        if (event === "error") {
          errorHandler = listener as (err: Error) => void;
        }
        return mockWorker as Worker;
      });

      // Don't provide a message response to keep the promise waiting
      mockWorker.once.mockImplementation(() => {
        // Don't call the message listener, leave promise pending
        return mockWorker as Worker;
      });

      const setupPromise = manager.setup();

      await flushPromises()

      // Trigger worker error during startup
      const testError = new Error("Worker startup error");
      expect(errorHandler).toBeDefined();
      errorHandler!(testError);

      // The setup should reject with the worker error, not timeout
      await expect(setupPromise).rejects.toThrow("Worker startup error");
    });

    it("should handle worker error during shutdown", async () => {
      // First, set up the manager successfully
      mockWorker.once.mockImplementation((event, listener) => {
        if (event === "message") {
          (listener as (response: WorkerResponse) => void)({
            type: WorkerResponseType.SERVER_STARTED,
            data: { port: 3000, url: "http://127.0.0.1:3000" },
          });
        }
        return mockWorker as Worker;
      });

      await manager.setup();
      jest.clearAllMocks();

      // Now test shutdown with error
      let errorHandler: (err: Error) => void;

      // Capture the error handler during shutdown
      mockWorker.addListener.mockImplementation((event, listener) => {
        if (event === "error") {
          errorHandler = listener as (err: Error) => void;
        }
        return mockWorker as Worker;
      });

      // Don't provide a shutdown message response
      mockWorker.once.mockImplementation(() => {
        // Don't call the message listener, leave promise pending
        return mockWorker as Worker;
      });

      const teardownPromise = manager.teardown();

      // Trigger worker error during shutdown
      const testError = new Error("Worker shutdown error");
      errorHandler!(testError);

      // The teardown should still complete (it catches errors and terminates)
      await expect(teardownPromise).resolves.toBeUndefined();

      // Should have called terminate due to error
      expect(mockWorker.terminate).toHaveBeenCalled();
    });
  });
});
