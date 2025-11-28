import { LocalDurableTestRunner } from "../local-durable-test-runner";
import { OperationWithData } from "../../common/operations/operation-with-data";
import { TestExecutionOrchestrator } from "../test-execution-orchestrator";
import { ResultFormatter } from "../result-formatter";
import { LocalOperationStorage } from "../operations/local-operation-storage";
import { OperationWaitManager } from "../operations/operation-wait-manager";
import { InvocationStatus } from "@aws/durable-execution-sdk-js";
import { CheckpointWorkerManager } from "../worker/checkpoint-worker-manager";
import { FunctionStorage } from "../operations/function-storage";
import { IndexedOperations } from "../../common/indexed-operations";
import { CheckpointWorkerApiClient } from "../api-client/checkpoint-worker-api-client";
import { install } from "@sinonjs/fake-timers";

jest.mock("../test-execution-orchestrator");
jest.mock("../result-formatter");
jest.mock("../operations/local-operation-storage");
jest.mock("../operations/operation-wait-manager");
jest.mock("../operations/function-storage");
jest.mock("@sinonjs/fake-timers");

describe("LocalDurableTestRunner", () => {
  const mockHandlerFunction = jest.fn();
  let mockOrchestrator: jest.Mocked<TestExecutionOrchestrator>;
  let mockResultFormatter: jest.Mocked<ResultFormatter<{ success: boolean }>>;
  let mockOperationStorage: Partial<jest.Mocked<LocalOperationStorage>>;
  let mockWaitManager: Partial<jest.Mocked<OperationWaitManager>>;
  let mockCheckpointServerWorkerManager: jest.Mocked<CheckpointWorkerManager>;
  let mockFunctionStorage: jest.Mocked<FunctionStorage>;

  beforeEach(() => {
    jest.resetAllMocks();

    // Mock CheckpointServerWorkerManager first since it's used in constructor
    const checkpointServerUrl = "http://127.0.0.1:1234";
    mockCheckpointServerWorkerManager = {
      getServerInfo: jest.fn().mockReturnValue({
        url: checkpointServerUrl,
        port: 1234,
      }),
      setup: jest.fn().mockResolvedValue({
        url: checkpointServerUrl,
        port: 1234,
      }),
      teardown: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CheckpointWorkerManager>;

    // Mock the getInstance method
    jest
      .spyOn(CheckpointWorkerManager, "getInstance")
      .mockReturnValue(mockCheckpointServerWorkerManager);

    // Create mock instances for dependency injection testing - now type-safe!
    mockWaitManager = {
      waitForOperation: jest.fn(),
      clearWaitingOperations: jest.fn(),
      handleCheckpointReceived: jest.fn(),
    };

    mockOperationStorage = {
      registerOperation: jest.fn(),
      populateOperations: jest.fn(),
      getHistoryEvents: jest.fn().mockReturnValue([]),
    };

    mockFunctionStorage = {
      registerFunction: jest.fn().mockReturnValue(mockFunctionStorage),
      registerDurableFunction: jest.fn().mockReturnValue(mockFunctionStorage),
      runHandler: jest.fn(),
    } as unknown as jest.Mocked<FunctionStorage>;

    mockOrchestrator = {
      executeHandler: jest.fn().mockResolvedValue({
        Status: InvocationStatus.SUCCEEDED,
        Result: JSON.stringify({ success: true }),
      }),
      getInvocations: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<TestExecutionOrchestrator>;

    mockResultFormatter = {
      formatTestResult: jest.fn().mockReturnValue({
        getOperations: jest.fn().mockReturnValue([]),
        getInvocations: jest.fn().mockReturnValue([]),
        getResult: jest.fn().mockReturnValue({ data: { success: true } }),
        getHistoryEvents: jest.fn(),
      }),
    } as unknown as jest.Mocked<ResultFormatter<{ success: boolean }>>;

    // Mock constructors to return our mocks and verify proper dependency injection
    (OperationWaitManager as jest.Mock).mockImplementation(
      () => mockWaitManager,
    );
    (LocalOperationStorage as jest.Mock).mockImplementation(
      () => mockOperationStorage,
    );
    (FunctionStorage as jest.Mock).mockImplementation(
      () => mockFunctionStorage,
    );
    (TestExecutionOrchestrator as unknown as jest.Mock).mockImplementation(
      () => mockOrchestrator,
    );
    (ResultFormatter as jest.Mock).mockImplementation(
      () => mockResultFormatter,
    );
  });

  beforeEach(() => {
    delete process.env.DURABLE_LOCAL_RUNNER_REGION;
    delete process.env.DURABLE_LOCAL_RUNNER_ENDPOINT;
    delete process.env.DURABLE_LOCAL_RUNNER_CREDENTIALS;
  });

  afterEach(() => {
    delete process.env.DURABLE_LOCAL_RUNNER_REGION;
    delete process.env.DURABLE_LOCAL_RUNNER_ENDPOINT;
    delete process.env.DURABLE_LOCAL_RUNNER_CREDENTIALS;
  });

  describe("constructor", () => {
    it("should initialize with required dependencies", () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      expect(runner).toBeDefined();
      expect(OperationWaitManager).toHaveBeenCalledWith(
        expect.any(IndexedOperations),
      );
      expect(LocalOperationStorage).toHaveBeenCalledWith(
        mockWaitManager,
        expect.any(Object),
        expect.any(Object),
        expect.any(Function),
      );
      expect(ResultFormatter).toHaveBeenCalled();
    });
  });

  describe("run", () => {
    it("should delegate to orchestrator and return formatted result", async () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      const params = { payload: { input: "test" } };
      const result = await runner.run(params);

      expect(mockOrchestrator.executeHandler).toHaveBeenCalledWith(params);
      expect(mockResultFormatter.formatTestResult).toHaveBeenCalledWith(
        expect.objectContaining({
          Status: InvocationStatus.SUCCEEDED,
          Result: JSON.stringify({ success: true }),
        }),
        [],
        mockOperationStorage,
      );
      expect(result.getResult()).toEqual({ data: { success: true } });
    });

    it("should propagate execution errors", async () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      const mockError = new Error("Execution failed");
      (mockOrchestrator.executeHandler as jest.Mock).mockRejectedValue(
        mockError,
      );

      await expect(runner.run()).rejects.toThrow("Execution failed");
    });

    it("should get server info from CheckpointServerWorkerManager during run", async () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      await runner.run();

      expect(CheckpointWorkerManager.getInstance).toHaveBeenCalled();
    });

    it("should create TestExecutionOrchestrator with correct dependencies during run", async () => {
      await LocalDurableTestRunner.setupTestEnvironment();

      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      await runner.run();

      // Verify TestExecutionOrchestrator was created with correct parameters
      expect(TestExecutionOrchestrator).toHaveBeenCalledWith(
        mockHandlerFunction,
        mockOperationStorage,
        expect.any(CheckpointWorkerApiClient),
        mockFunctionStorage,
        {
          enabled: false,
        }, // skipTime default
      );
    });

    it("should pass skipTime parameter to TestExecutionOrchestrator", async () => {
      await LocalDurableTestRunner.setupTestEnvironment({
        skipTime: true,
      });

      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      await runner.run();

      expect(TestExecutionOrchestrator).toHaveBeenCalledWith(
        mockHandlerFunction,
        mockOperationStorage,
        expect.any(CheckpointWorkerApiClient), // CheckpointWorkerApiClient created with server URL
        mockFunctionStorage,
        {
          enabled: true,
        }, // skipTime
      );
    });

    it("should clear waiting operations even when execution fails", async () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      const mockError = new Error("Execution failed");
      (mockOrchestrator.executeHandler as jest.Mock).mockRejectedValue(
        mockError,
      );

      await expect(runner.run()).rejects.toThrow("Execution failed");

      // Verify cleanup was still called
      expect(mockWaitManager.clearWaitingOperations).toHaveBeenCalled();
    });

    it("should sort history events from operation storage", async () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      const mockHistoryEvents = [
        { EventId: 2 },
        { EventId: 1 },
        { EventId: 3 },
      ];
      (mockOperationStorage.getHistoryEvents as jest.Mock).mockReturnValue(
        mockHistoryEvents,
      );

      await runner.run();

      expect(mockResultFormatter.formatTestResult).toHaveBeenCalledWith(
        expect.objectContaining({
          Status: InvocationStatus.SUCCEEDED,
          Result: JSON.stringify({ success: true }),
        }),
        [{ EventId: 1 }, { EventId: 2 }, { EventId: 3 }],
        mockOperationStorage,
      );
    });
  });

  describe("getOperation methods", () => {
    it("should create and register operation by name", () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      const operation = runner.getOperation("testOp");

      expect(operation).toBeInstanceOf(OperationWithData);
      expect(mockOperationStorage.registerOperation).toHaveBeenCalledWith({
        operation,
        params: {
          name: "testOp",
        },
      });
    });

    it("should create and register operation by index", () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      const operation = runner.getOperationByIndex(2);

      expect(operation).toBeInstanceOf(OperationWithData);
      expect(mockOperationStorage.registerOperation).toHaveBeenCalledWith({
        operation,
        params: {
          index: 2,
        },
      });
    });

    it("should create and register operation by name and index", () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      const operation = runner.getOperationByNameAndIndex("testOp", 2);

      expect(operation).toBeInstanceOf(OperationWithData);
      expect(mockOperationStorage.registerOperation).toHaveBeenCalledWith({
        operation,
        params: {
          index: 2,
          name: "testOp",
        },
      });
    });

    it("should create and register operation by ID", () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      const operation = runner.getOperationById("op-123");

      expect(operation).toBeInstanceOf(OperationWithData);
      expect(mockOperationStorage.registerOperation).toHaveBeenCalledWith({
        operation,
        params: {
          id: "op-123",
        },
      });
    });
  });

  describe("registerFunctions", () => {
    it("should register durable functions with function storage", () => {
      const runner = new LocalDurableTestRunner({
        handlerFunction: mockHandlerFunction,
      });

      const mockDurableHandler = jest.fn();

      runner.registerDurableFunction("durableFunction", mockDurableHandler);

      expect(mockFunctionStorage.registerDurableFunction).toHaveBeenCalledWith(
        "durableFunction",
        mockDurableHandler,
      );
    });

    it("should register functions with function storage", () => {
      const runner = new LocalDurableTestRunner({
        handlerFunction: mockHandlerFunction,
      });

      const mockHandler = jest.fn();

      runner.registerFunction("function", mockHandler);

      expect(mockFunctionStorage.registerFunction).toHaveBeenCalledWith(
        "function",
        mockHandler,
      );
    });

    it("should register durable and non-durable functions with function storage", () => {
      const runner = new LocalDurableTestRunner({
        handlerFunction: mockHandlerFunction,
      });

      const mockHandler = jest.fn();
      const mockDurableHandler = jest.fn();

      runner
        .registerFunction("function", mockHandler)
        .registerDurableFunction("durableFunction", mockDurableHandler);

      expect(mockFunctionStorage.registerFunction).toHaveBeenCalledWith(
        "function",
        mockHandler,
      );
      expect(mockFunctionStorage.registerDurableFunction).toHaveBeenCalledWith(
        "durableFunction",
        mockDurableHandler,
      );
    });
  });

  describe("static environment methods", () => {
    describe("setupTestEnvironment", () => {
      let mockFakeClock: jest.Mocked<{ uninstall: jest.Mock }>;

      beforeEach(() => {
        mockFakeClock = {
          uninstall: jest.fn(),
        };
        (install as jest.Mock).mockReturnValue(mockFakeClock);
      });

      afterEach(() => {
        // Clean up static state after each test
        LocalDurableTestRunner.skipTime = false;
        (
          LocalDurableTestRunner as unknown as { fakeClock: unknown }
        ).fakeClock = undefined;
      });

      it("should set skipTime to false by default", async () => {
        await LocalDurableTestRunner.setupTestEnvironment();

        expect(LocalDurableTestRunner.skipTime).toBe(false);
      });

      it("should set skipTime to true when specified in params", async () => {
        await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });

        expect(LocalDurableTestRunner.skipTime).toBe(true);
      });

      it("should set skipTime to false when explicitly specified in params", async () => {
        await LocalDurableTestRunner.setupTestEnvironment({ skipTime: false });

        expect(LocalDurableTestRunner.skipTime).toBe(false);
      });

      it("should not install fake timers if skip time is disabled", async () => {
        await LocalDurableTestRunner.setupTestEnvironment();

        expect(install).not.toHaveBeenCalled();
        expect(
          (LocalDurableTestRunner as unknown as { fakeClock: unknown })
            .fakeClock,
        ).toBeUndefined();
      });

      it("should install fake timers with correct configuration", async () => {
        jest.spyOn(Date, "now").mockReturnValue(1);

        await LocalDurableTestRunner.setupTestEnvironment({
          skipTime: true,
        });

        expect(install).toHaveBeenCalledWith({
          shouldAdvanceTime: true,
          shouldClearNativeTimers: true,
          now: 1,
        });
        expect(
          (LocalDurableTestRunner as unknown as { fakeClock: unknown })
            .fakeClock,
        ).toBe(mockFakeClock);
      });

      it("should throw error if fake timers failed to be installed", async () => {
        const installError = new Error("Failed to install fake timers");
        (install as jest.Mock).mockImplementation(() => {
          throw installError;
        });

        // Should not throw an error
        await expect(
          LocalDurableTestRunner.setupTestEnvironment({
            skipTime: true,
          }),
        ).rejects.toThrow(installError);

        expect(install).toHaveBeenCalled();
        expect(
          (LocalDurableTestRunner as unknown as { fakeClock: unknown })
            .fakeClock,
        ).toBeUndefined();
      });

      it("should propagate setup errors", async () => {
        const setupError = new Error("Failed to start checkpoint server");
        mockCheckpointServerWorkerManager.setup.mockRejectedValue(setupError);

        await expect(
          LocalDurableTestRunner.setupTestEnvironment(),
        ).rejects.toThrow("Failed to start checkpoint server");

        expect(CheckpointWorkerManager.getInstance).toHaveBeenCalled();
        expect(mockCheckpointServerWorkerManager.setup).toHaveBeenCalled();
      });
    });

    describe("teardownTestEnvironment", () => {
      let mockFakeClock: jest.Mocked<{ uninstall: jest.Mock }>;

      beforeEach(() => {
        mockFakeClock = {
          uninstall: jest.fn(),
        };
      });

      afterEach(() => {
        // Clean up static state after each test
        LocalDurableTestRunner.skipTime = false;
        (
          LocalDurableTestRunner as unknown as { fakeClock: unknown }
        ).fakeClock = undefined;
      });

      it("should delegate to CheckpointServerWorkerManager.getInstance().teardown()", async () => {
        mockCheckpointServerWorkerManager.teardown.mockResolvedValue(undefined);

        await LocalDurableTestRunner.teardownTestEnvironment();

        expect(CheckpointWorkerManager.getInstance).toHaveBeenCalled();
        expect(mockCheckpointServerWorkerManager.teardown).toHaveBeenCalled();
      });

      it("should uninstall fake clock when it exists", async () => {
        // Set up fake clock on the static class
        (
          LocalDurableTestRunner as unknown as { fakeClock: unknown }
        ).fakeClock = mockFakeClock;

        await LocalDurableTestRunner.teardownTestEnvironment();

        expect(mockFakeClock.uninstall).toHaveBeenCalled();
      });

      it("should set fake clock to undefined after uninstalling", async () => {
        // Set up fake clock on the static class
        (
          LocalDurableTestRunner as unknown as { fakeClock: unknown }
        ).fakeClock = mockFakeClock;

        await LocalDurableTestRunner.teardownTestEnvironment();

        expect(
          (LocalDurableTestRunner as unknown as { fakeClock: unknown })
            .fakeClock,
        ).toBeUndefined();
      });

      it("should handle teardown when fake clock is undefined", async () => {
        // Ensure fake clock is undefined
        (
          LocalDurableTestRunner as unknown as { fakeClock: unknown }
        ).fakeClock = undefined;

        // Should not throw an error
        await expect(
          LocalDurableTestRunner.teardownTestEnvironment(),
        ).resolves.toBeUndefined();

        expect(mockFakeClock.uninstall).not.toHaveBeenCalled();
      });

      it("should propagate teardown errors", async () => {
        const teardownError = new Error("Failed to shutdown checkpoint server");
        mockCheckpointServerWorkerManager.teardown.mockRejectedValue(
          teardownError,
        );

        await expect(
          LocalDurableTestRunner.teardownTestEnvironment(),
        ).rejects.toThrow("Failed to shutdown checkpoint server");

        expect(CheckpointWorkerManager.getInstance).toHaveBeenCalled();
        expect(mockCheckpointServerWorkerManager.teardown).toHaveBeenCalled();
      });
    });

    describe("environment lifecycle integration", () => {
      let mockFakeClock: jest.Mocked<{ uninstall: jest.Mock }>;

      beforeEach(() => {
        mockFakeClock = {
          uninstall: jest.fn(),
        };
        (install as jest.Mock).mockReturnValue(mockFakeClock);
      });

      afterEach(() => {
        // Clean up static state after each test
        LocalDurableTestRunner.skipTime = false;
        (
          LocalDurableTestRunner as unknown as { fakeClock: unknown }
        ).fakeClock = undefined;
      });

      it("should allow setup and teardown to be called in sequence", async () => {
        mockCheckpointServerWorkerManager.setup.mockResolvedValue();
        mockCheckpointServerWorkerManager.teardown.mockResolvedValue(undefined);

        // Setup
        await LocalDurableTestRunner.setupTestEnvironment();

        // Teardown
        await LocalDurableTestRunner.teardownTestEnvironment();

        expect(mockCheckpointServerWorkerManager.setup).toHaveBeenCalledTimes(
          1,
        );
        expect(
          mockCheckpointServerWorkerManager.teardown,
        ).toHaveBeenCalledTimes(1);
      });

      it("should handle complete fake clock lifecycle with skipTime enabled", async () => {
        const mockNow = 1640995200000; // 2022-01-01T00:00:00.000Z
        jest.spyOn(Date, "now").mockReturnValue(mockNow);

        // Setup with skipTime enabled
        await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });

        // Verify fake clock was installed with correct config
        expect(install).toHaveBeenCalledWith({
          shouldAdvanceTime: true,
          shouldClearNativeTimers: true,
          now: mockNow,
        });
        expect(LocalDurableTestRunner.skipTime).toBe(true);
        expect(
          (LocalDurableTestRunner as unknown as { fakeClock: unknown })
            .fakeClock,
        ).toBe(mockFakeClock);

        // Create and run a test instance
        const runner = new LocalDurableTestRunner<{ success: boolean }>({
          handlerFunction: mockHandlerFunction,
        });

        await runner.run();

        // Verify orchestrator was created with skipTime enabled and fakeClock
        expect(TestExecutionOrchestrator).toHaveBeenCalledWith(
          mockHandlerFunction,
          mockOperationStorage,
          expect.any(CheckpointWorkerApiClient),
          mockFunctionStorage,
          {
            enabled: true,
            fakeClock: mockFakeClock,
          },
        );

        // Teardown and verify fake clock cleanup
        await LocalDurableTestRunner.teardownTestEnvironment();

        expect(mockFakeClock.uninstall).toHaveBeenCalled();
        expect(
          (LocalDurableTestRunner as unknown as { fakeClock: unknown })
            .fakeClock,
        ).toBeUndefined();
      });
    });
  });
});
