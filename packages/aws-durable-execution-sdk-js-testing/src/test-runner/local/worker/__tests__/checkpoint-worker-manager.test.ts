import { CheckpointWorkerManager } from "../checkpoint-worker-manager";
import { Worker } from "worker_threads";
import * as fs from "fs/promises";
import * as path from "path";
import { defaultLogger } from "../../../../logger";
import { ApiType } from "../../../../checkpoint-server/worker-api/worker-api-types";
import { createInvocationId } from "../../../../checkpoint-server/utils/tagged-strings";
import { StartDurableExecutionRequest } from "../../../../checkpoint-server/worker-api/worker-api-request";

// Mock worker_threads
jest.mock("worker_threads");
jest.mock("fs/promises");

const MockWorker = Worker as jest.MockedClass<typeof Worker>;
const mockFs = fs as jest.Mocked<typeof fs>;

describe("CheckpointWorkerManager", () => {
  let mockWorker: jest.Mocked<Worker>;
  let manager: CheckpointWorkerManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Mock defaultLogger.warn to avoid noise in test output
    defaultLogger.warn = jest.fn();

    // Create a simplified mock worker
    mockWorker = {
      on: jest.fn().mockReturnThis(),
      postMessage: jest.fn(),
      terminate: jest.fn().mockResolvedValue(undefined),
      unref: jest.fn(),
    } as unknown as jest.Mocked<Worker>;

    // Mock Worker constructor
    MockWorker.mockImplementation(() => mockWorker);

    // Reset singleton instance before each test
    CheckpointWorkerManager.resetInstanceForTesting();
    manager = CheckpointWorkerManager.getInstance({}); // pass params for initial create
  });

  describe("Singleton Pattern", () => {
    it("should return the same instance across multiple calls", () => {
      const instance1 = CheckpointWorkerManager.getInstance();
      const instance2 = CheckpointWorkerManager.getInstance();
      const instance3 = CheckpointWorkerManager.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
      expect(instance1).toBe(manager);
    });

    it("should create new instance after reset", () => {
      const instance1 = CheckpointWorkerManager.getInstance();
      CheckpointWorkerManager.resetInstanceForTesting();
      const instance2 = CheckpointWorkerManager.getInstance({});

      expect(instance1).not.toBe(instance2);
    });

    it("should throw error when getInstance called without params and no instance exists", () => {
      CheckpointWorkerManager.resetInstanceForTesting();

      expect(() => {
        CheckpointWorkerManager.getInstance();
      }).toThrow("CheckpointWorkerManager has not been created");
    });

    it("should return existing instance even when called with different params", () => {
      CheckpointWorkerManager.resetInstanceForTesting();
      const instance1 = CheckpointWorkerManager.getInstance({
        checkpointDelaySettings: 50,
      });

      // Subsequent calls should return the same instance, ignoring new params
      // TODO: we should update params when this happens instead of ignoring them
      const instance2 = CheckpointWorkerManager.getInstance({
        checkpointDelaySettings: 100,
      });

      expect(instance1).toBe(instance2);
    });
  });

  describe("Worker Path Resolution", () => {
    it("should use dev path when index.ts exists", async () => {
      // Mock fs.access to succeed for dev path
      mockFs.access.mockResolvedValue(undefined);

      await manager.setup();

      // The actual path resolution from CheckpointWorkerManager perspective
      const expectedDevPath = path.resolve(
        __dirname,
        "../../../../checkpoint-server/index.ts",
      );

      expect(MockWorker).toHaveBeenCalledWith(expectedDevPath, {
        execArgv: ["--require", "tsx/cjs"],
        workerData: {},
      });
    });

    it("should fallback to prod path when index.ts does not exist", async () => {
      // Mock fs.access to fail for dev path (file doesn't exist)
      mockFs.access.mockRejectedValue(new Error("File not found"));

      await manager.setup();

      // The actual path resolution from CheckpointWorkerManager perspective
      const expectedProdPath = path.resolve(
        __dirname,
        "../checkpoint-server/index.js",
      );

      expect(MockWorker).toHaveBeenCalledWith(expectedProdPath, {
        execArgv: undefined,
        workerData: {},
      });
    });
  });

  describe("setup", () => {
    beforeEach(() => {
      mockFs.access.mockResolvedValue(undefined); // Default to dev path
    });

    it("should create worker and setup event listeners", async () => {
      await manager.setup();

      expect(MockWorker).toHaveBeenCalledTimes(1);
      expect(mockWorker.on).toHaveBeenCalledWith("error", expect.any(Function));
      expect(mockWorker.on).toHaveBeenCalledWith("exit", expect.any(Function));
      expect(mockWorker.on).toHaveBeenCalledWith(
        "message",
        expect.any(Function),
      );
    });

    it("should pass constructor params to worker as workerData", async () => {
      CheckpointWorkerManager.resetInstanceForTesting();
      const testParams = {
        checkpointDelaySettings: 100,
      };
      const managerWithParams = CheckpointWorkerManager.getInstance(testParams);

      await managerWithParams.setup();

      expect(MockWorker).toHaveBeenCalledWith(
        expect.any(String), // worker path
        {
          execArgv: ["--require", "tsx/cjs"],
          workerData: testParams,
        },
      );
    });

    it("should throw error if worker already running", async () => {
      // First setup should succeed
      await manager.setup();

      // Second setup should fail
      await expect(manager.setup()).rejects.toThrow(
        "Worker thread is already running",
      );
    });
  });

  describe("sendApiRequest", () => {
    beforeEach(async () => {
      mockFs.access.mockResolvedValue(undefined);
      await manager.setup();
    });

    it("should throw error when worker not initialized", async () => {
      // Create a fresh manager without setup
      CheckpointWorkerManager.resetInstanceForTesting();
      const freshManager = CheckpointWorkerManager.getInstance({});

      await expect(
        freshManager.sendApiRequest(ApiType.StartDurableExecution, {
          payload: "test-payload",
          invocationId: createInvocationId(),
        }),
      ).rejects.toThrow("Worker not initialized");
    });
  });

  describe("teardown", () => {
    it("should handle no worker gracefully", async () => {
      // Should not throw when called without setup
      await expect(manager.teardown()).resolves.toBeUndefined();
    });

    it("should call unref and clear worker", async () => {
      mockFs.access.mockResolvedValue(undefined);
      await manager.setup();

      await manager.teardown();

      expect(mockWorker.unref).toHaveBeenCalled();
    });

    it("should handle unref errors gracefully and terminate worker", async () => {
      mockFs.access.mockResolvedValue(undefined);
      await manager.setup();

      // Mock unref to throw error
      mockWorker.unref.mockImplementation(() => {
        throw new Error("Unref failed");
      });

      await manager.teardown();

      expect(mockWorker.unref).toHaveBeenCalled();
      expect(mockWorker.terminate).toHaveBeenCalled();
    });

    it("should handle terminate errors gracefully", async () => {
      mockFs.access.mockResolvedValue(undefined);
      await manager.setup();

      // Mock both unref and terminate to throw errors
      mockWorker.unref.mockImplementation(() => {
        throw new Error("Unref failed");
      });
      mockWorker.terminate.mockRejectedValue(new Error("Terminate failed"));

      await manager.teardown();

      expect(mockWorker.unref).toHaveBeenCalled();
      expect(mockWorker.terminate).toHaveBeenCalled();
    });
  });

  describe("Worker Event Handling", () => {
    beforeEach(async () => {
      mockFs.access.mockResolvedValue(undefined);
      await manager.setup();
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

      // Re-setup to capture the handler
      CheckpointWorkerManager.resetInstanceForTesting();
      manager = CheckpointWorkerManager.getInstance({});
      await manager.setup();

      // Simulate worker error
      const testError = new Error("Worker runtime error");
      errorHandler!(testError);

      expect(defaultLogger.warn).toHaveBeenCalledWith(
        "There was a worker error: ",
        testError,
      );
    });

    it("should handle worker exit with non-zero code", async () => {
      let exitHandler: (code: number) => void;

      mockWorker.on.mockImplementation((event, listener) => {
        if (event === "exit") {
          exitHandler = listener as (code: number) => void;
        }
        return mockWorker as Worker;
      });

      // Re-setup to capture the handler
      CheckpointWorkerManager.resetInstanceForTesting();
      manager = CheckpointWorkerManager.getInstance({});
      await manager.setup();

      // Simulate worker exit with non-zero code
      exitHandler!(1);

      expect(defaultLogger.warn).toHaveBeenCalledWith(
        "Worker exited with code: 1",
      );
    });

    it("should handle worker exit with zero code silently", async () => {
      let exitHandler: (code: number) => void;

      mockWorker.on.mockImplementation((event, listener) => {
        if (event === "exit") {
          exitHandler = listener as (code: number) => void;
        }
        return mockWorker as Worker;
      });

      // Re-setup to capture the handler
      CheckpointWorkerManager.resetInstanceForTesting();
      manager = CheckpointWorkerManager.getInstance({});
      await manager.setup();

      // Simulate worker exit with zero code (normal exit)
      exitHandler!(0);

      expect(defaultLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("Worker exited with code:"),
      );
    });
  });

  describe("sendApiRequest delegation", () => {
    beforeEach(async () => {
      mockFs.access.mockResolvedValue(undefined);
      await manager.setup();
    });

    it("should delegate to worker via postMessage", async () => {
      // Mock worker.postMessage to capture and simulate the API call
      mockWorker.postMessage.mockImplementation(
        (message: {
          type: string;
          data: { requestId: string; type: string };
        }) => {
          // Simulate the worker responding back through message handler
          const messageHandlers = mockWorker.on.mock.calls
            .filter(([event]) => event === "message")
            .map(([, handler]) => handler);

          if (messageHandlers.length > 0) {
            const messageHandler = messageHandlers[0];
            setTimeout(() => {
              messageHandler({
                type: "API_RESPONSE",
                data: {
                  requestId: message.data.requestId,
                  type: message.data.type,
                  response: { result: "success" },
                },
              });
            }, 0);
          }
        },
      );

      const params: StartDurableExecutionRequest = {
        payload: "test-payload",
        invocationId: createInvocationId(),
      };

      const promise = manager.sendApiRequest(
        ApiType.StartDurableExecution,
        params,
      );

      // Verify worker.postMessage was called with correct structure
      expect(mockWorker.postMessage).toHaveBeenCalledWith({
        type: "API_REQUEST",
        data: {
          requestId: expect.any(String),
          type: ApiType.StartDurableExecution,
          params,
        },
      });

      const result = await promise;
      expect(result).toEqual({ result: "success" });
    });
  });
});
