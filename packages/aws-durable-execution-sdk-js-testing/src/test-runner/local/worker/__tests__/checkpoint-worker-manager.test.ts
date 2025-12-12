import { CheckpointWorkerManager } from "../checkpoint-worker-manager";
import { Worker } from "worker_threads";
import * as path from "path";
import { defaultLogger } from "../../../../logger";
import { ApiType } from "../../../../checkpoint-server/worker-api/worker-api-types";
import { createInvocationId } from "../../../../checkpoint-server/utils/tagged-strings";
import { StartDurableExecutionRequest } from "../../../../checkpoint-server/worker-api/worker-api-request";

// Mock worker_threads
jest.mock("worker_threads");

const MockWorker = Worker as jest.MockedClass<typeof Worker>;

describe("CheckpointWorkerManager", () => {
  let mockWorker: jest.Mocked<Worker>;
  let manager: CheckpointWorkerManager;
  let originalNodeEnv: string | undefined;
  let originalIsESM: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Store original env values
    originalNodeEnv = process.env.NODE_ENV;
    originalIsESM = process.env.IS_ESM;

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
    manager = CheckpointWorkerManager.getInstance({});
  });

  afterEach(() => {
    // Restore original env values
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalIsESM === undefined) {
      delete process.env.IS_ESM;
    } else {
      process.env.IS_ESM = originalIsESM;
    }
  });

  describe("Singleton Pattern", () => {
    it("should return the same instance across multiple calls", () => {
      const instance1 = CheckpointWorkerManager.getInstance();
      const instance2 = CheckpointWorkerManager.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance1).toBe(manager);
    });

    it("should throw error when getInstance called without params and no instance exists", () => {
      CheckpointWorkerManager.resetInstanceForTesting();

      expect(() => {
        CheckpointWorkerManager.getInstance();
      }).toThrow("CheckpointWorkerManager has not been created");
    });

    it("should create new instance with params after reset", () => {
      const instance1 = CheckpointWorkerManager.getInstance();
      CheckpointWorkerManager.resetInstanceForTesting();
      const instance2 = CheckpointWorkerManager.getInstance({
        checkpointDelaySettings: 100,
      });

      expect(instance1).not.toBe(instance2);
    });
  });

  describe("Worker Path Resolution", () => {
    it("should use dev path when NODE_ENV is not production", async () => {
      delete process.env.NODE_ENV; // Not production

      await manager.setup();

      const expectedDevPath = path.resolve(
        __dirname,
        "../../../../checkpoint-server/index.ts",
      );

      expect(MockWorker).toHaveBeenCalledWith(expectedDevPath, {
        execArgv: ["--require", "tsx/cjs"],
        workerData: {},
      });
    });

    describe("Production environment behavior", () => {
      beforeEach(() => {
        process.env.NODE_ENV = "production";
      });

      it("should use .js extension when IS_ESM is falsy or undefined", async () => {
        delete process.env.IS_ESM;

        await manager.setup();

        const expectedProdPath = path.resolve(
          __dirname,
          "../checkpoint-server/index.js",
        );

        expect(MockWorker).toHaveBeenCalledWith(expectedProdPath, {
          execArgv: undefined,
          workerData: {},
        });
      });

      it.each([
        { IS_ESM: "true", expectedExt: "mjs" },
        { IS_ESM: "1", expectedExt: "mjs" },
        { IS_ESM: "false", expectedExt: "mjs" }, // "false" string is truthy in JS
        { IS_ESM: "", expectedExt: "js" }, // empty string is falsy
        { IS_ESM: "0", expectedExt: "mjs" }, // "0" string is truthy in JS
      ])(
        "should use .$expectedExt extension when IS_ESM is '$IS_ESM'",
        async ({ IS_ESM, expectedExt }) => {
          process.env.IS_ESM = IS_ESM;

          await manager.setup();

          const expectedProdPath = path.resolve(
            __dirname,
            `../checkpoint-server/index.${expectedExt}`,
          );

          expect(MockWorker).toHaveBeenCalledWith(expectedProdPath, {
            execArgv: undefined,
            workerData: {},
          });
        },
      );

      it("should ignore IS_ESM when NODE_ENV is not production", async () => {
        process.env.NODE_ENV = "development";
        process.env.IS_ESM = "true";

        await manager.setup();

        const expectedDevPath = path.resolve(
          __dirname,
          "../../../../checkpoint-server/index.ts",
        );

        expect(MockWorker).toHaveBeenCalledWith(expectedDevPath, {
          execArgv: ["--require", "tsx/cjs"],
          workerData: {},
        });
      });
    });
  });

  describe("Worker Management", () => {
    it("should create worker with params and setup event listeners", async () => {
      CheckpointWorkerManager.resetInstanceForTesting();
      const testParams = { checkpointDelaySettings: 100 };
      const managerWithParams = CheckpointWorkerManager.getInstance(testParams);

      await managerWithParams.setup();

      expect(MockWorker).toHaveBeenCalledTimes(1);
      expect(MockWorker).toHaveBeenCalledWith(expect.any(String), {
        execArgv: expect.any(Array),
        workerData: testParams,
      });
      expect(mockWorker.on).toHaveBeenCalledWith("error", expect.any(Function));
      expect(mockWorker.on).toHaveBeenCalledWith("exit", expect.any(Function));
      expect(mockWorker.on).toHaveBeenCalledWith(
        "message",
        expect.any(Function),
      );
    });

    it("should throw error if setup called when worker already running", async () => {
      await manager.setup();

      await expect(manager.setup()).rejects.toThrow(
        "Worker thread is already running",
      );
    });

    it("should throw error when sendApiRequest called without setup", async () => {
      CheckpointWorkerManager.resetInstanceForTesting();
      const freshManager = CheckpointWorkerManager.getInstance({});

      await expect(
        freshManager.sendApiRequest(ApiType.StartDurableExecution, {
          payload: "test-payload",
          invocationId: createInvocationId(),
        }),
      ).rejects.toThrow("Worker not initialized");
    });

    it("should handle teardown gracefully when no worker exists", async () => {
      await expect(manager.teardown()).resolves.toBeUndefined();
    });

    it("should call unref during teardown", async () => {
      await manager.setup();

      await manager.teardown();

      expect(mockWorker.unref).toHaveBeenCalled();
    });

    it("should handle unref errors and terminate worker", async () => {
      await manager.setup();

      mockWorker.unref.mockImplementation(() => {
        throw new Error("Unref failed");
      });

      await manager.teardown();

      expect(mockWorker.unref).toHaveBeenCalled();
      expect(mockWorker.terminate).toHaveBeenCalled();
    });
  });

  describe("Worker Event Handling", () => {
    it("should log worker errors", async () => {
      let errorHandler: (err: Error) => void;

      mockWorker.on.mockImplementation((event, listener) => {
        if (event === "error") {
          errorHandler = listener as (err: Error) => void;
        }
        return mockWorker as Worker;
      });

      await manager.setup();

      const testError = new Error("Worker runtime error");
      errorHandler!(testError);

      expect(defaultLogger.warn).toHaveBeenCalledWith(
        "There was a worker error: ",
        testError,
      );
    });

    it("should log non-zero exit codes", async () => {
      let exitHandler: (code: number) => void;

      mockWorker.on.mockImplementation((event, listener) => {
        if (event === "exit") {
          exitHandler = listener as (code: number) => void;
        }
        return mockWorker as Worker;
      });

      await manager.setup();

      exitHandler!(1);

      expect(defaultLogger.warn).toHaveBeenCalledWith(
        "Worker exited with code: 1",
      );
    });

    it("should not log zero exit codes", async () => {
      let exitHandler: (code: number) => void;

      mockWorker.on.mockImplementation((event, listener) => {
        if (event === "exit") {
          exitHandler = listener as (code: number) => void;
        }
        return mockWorker as Worker;
      });

      await manager.setup();

      exitHandler!(0);

      expect(defaultLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("Worker exited with code:"),
      );
    });
  });

  describe("API Request Delegation", () => {
    beforeEach(async () => {
      await manager.setup();
    });

    it("should delegate API requests to worker and return response", async () => {
      // Mock worker.postMessage and simulate response
      mockWorker.postMessage.mockImplementation(
        (message: {
          type: string;
          data: { requestId: string; type: string };
        }) => {
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
