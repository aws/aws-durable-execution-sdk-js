import { LocalDurableTestRunner } from "../local-durable-test-runner";
import { MockOperation } from "../operations/mock-operation";
import { TestExecutionOrchestrator } from "../test-execution-orchestrator";
import { ResultFormatter } from "../result-formatter";
import { OperationStorage } from "../operations/operation-storage";
import { OperationWaitManager } from "../operations/operation-wait-manager";
import { InvocationStatus } from "@amzn/durable-executions-language-sdk";
import { CheckpointServerWorkerManager } from "../checkpoint-server-worker-manager";
import { Scheduler } from "../orchestration/scheduler";
import { CheckpointApiClient } from "../api-client/checkpoint-api-client";

jest.mock("../test-execution-orchestrator");
jest.mock("../result-formatter");
jest.mock("../operations/operation-storage");
jest.mock("../operations/operation-wait-manager");
jest.mock("../checkpoint-server-worker-manager");

describe("LocalDurableTestRunner", () => {
  const mockHandlerFunction = jest.fn();
  let mockOrchestrator: jest.Mocked<TestExecutionOrchestrator>;
  let mockResultFormatter: jest.Mocked<ResultFormatter<{ success: boolean }>>;
  let mockOperationStorage: Partial<jest.Mocked<OperationStorage>>;
  let mockWaitManager: Partial<jest.Mocked<OperationWaitManager>>;
  let mockCheckpointServerWorkerManager: jest.Mocked<CheckpointServerWorkerManager>;

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
    } as unknown as jest.Mocked<CheckpointServerWorkerManager>;

    // Mock the getInstance method
    jest
      .spyOn(CheckpointServerWorkerManager, "getInstance")
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
    };

    mockOrchestrator = {
      executeHandler: jest.fn().mockResolvedValue({
        Status: InvocationStatus.SUCCEEDED,
        Result: JSON.stringify({ success: true }),
      }),
      getInvocations: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<TestExecutionOrchestrator>;

    mockResultFormatter = {
      formatTestResult: jest.fn().mockReturnValue({
        getCompletedOperations: jest.fn().mockReturnValue([]),
        getInvocations: jest.fn().mockReturnValue([]),
        getResult: jest.fn().mockReturnValue({ data: { success: true } }),
      }),
    } as unknown as jest.Mocked<ResultFormatter<{ success: boolean }>>;

    // Mock constructors to return our mocks and verify proper dependency injection
    (OperationWaitManager as jest.Mock).mockImplementation(
      () => mockWaitManager
    );
    (OperationStorage as jest.Mock).mockImplementation(
      () => mockOperationStorage
    );
    (TestExecutionOrchestrator as unknown as jest.Mock).mockImplementation(
      () => mockOrchestrator
    );
    (ResultFormatter as jest.Mock).mockImplementation(
      () => mockResultFormatter
    );
  });

  describe("constructor", () => {
    it("should initialize with required dependencies", () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      expect(runner).toBeDefined();
      expect(OperationWaitManager).toHaveBeenCalledWith();
      expect(OperationStorage).toHaveBeenCalledWith(
        mockWaitManager,
        expect.any(Object),
        expect.any(Function)
      );
      expect(ResultFormatter).toHaveBeenCalled();
    });

    it("should not call CheckpointServerWorkerManager during construction", () => {
      new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      // CheckpointServerWorkerManager should not be called in constructor, only in run()
      expect(CheckpointServerWorkerManager.getInstance).not.toHaveBeenCalled();
      expect(TestExecutionOrchestrator).not.toHaveBeenCalled();
    });

    it("should handle skipTime parameter", () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
        skipTime: true,
      });

      expect(runner).toBeDefined();
      // Constructor should still not call external dependencies
      expect(CheckpointServerWorkerManager.getInstance).not.toHaveBeenCalled();
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
        mockOperationStorage,
        []
      );
      expect(result.getResult()).toEqual({ data: { success: true } });
    });

    it("should handle execution without parameters", async () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      await runner.run();

      expect(mockOrchestrator.executeHandler).toHaveBeenCalledWith(undefined);
    });

    it("should propagate execution errors", async () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      const mockError = new Error("Execution failed");
      (mockOrchestrator.executeHandler as jest.Mock).mockRejectedValue(
        mockError
      );

      await expect(runner.run()).rejects.toThrow("Execution failed");
    });

    it("should get server info from CheckpointServerWorkerManager during run", async () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      await runner.run();

      expect(CheckpointServerWorkerManager.getInstance).toHaveBeenCalled();
      expect(
        mockCheckpointServerWorkerManager.getServerInfo
      ).toHaveBeenCalled();
    });

    it("should create TestExecutionOrchestrator with correct dependencies during run", async () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      await runner.run();

      // Verify TestExecutionOrchestrator was created with correct parameters
      expect(TestExecutionOrchestrator).toHaveBeenCalledWith(
        mockHandlerFunction,
        mockOperationStorage,
        expect.any(CheckpointApiClient), // CheckpointApiClient created with server URL
        expect.any(Scheduler), // Scheduler
        false // skipTime default
      );
    });

    it("should pass skipTime parameter to TestExecutionOrchestrator", async () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
        skipTime: true,
      });

      await runner.run();

      expect(TestExecutionOrchestrator).toHaveBeenCalledWith(
        mockHandlerFunction,
        mockOperationStorage,
        expect.any(CheckpointApiClient), // CheckpointApiClient created with server URL
        expect.any(Scheduler), // Scheduler
        true // skipTime
      );
    });

    it("should clear waiting operations even when execution fails", async () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      const mockError = new Error("Execution failed");
      (mockOrchestrator.executeHandler as jest.Mock).mockRejectedValue(
        mockError
      );

      await expect(runner.run()).rejects.toThrow("Execution failed");

      // Verify cleanup was still called
      expect(mockWaitManager.clearWaitingOperations).toHaveBeenCalled();
    });
  });

  describe("getOperation methods", () => {
    it("should create and register mock operation by name", () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      const operation = runner.getOperation("testOp");

      expect(operation).toBeInstanceOf(MockOperation);
      expect(operation._mockName).toBe("testOp");
      expect(mockOperationStorage.registerOperation).toHaveBeenCalledWith(
        operation
      );
    });

    it("should create and register mock operation by index", () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      const operation = runner.getOperationByIndex(2);

      expect(operation).toBeInstanceOf(MockOperation);
      expect(operation._mockName).toBeUndefined();
      expect(operation._mockIndex).toBe(2);
      expect(mockOperationStorage.registerOperation).toHaveBeenCalledWith(
        operation
      );
    });

    it("should create and register mock operation by name and index", () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      const operation = runner.getOperationByNameAndIndex("testOp", 2);

      expect(operation).toBeInstanceOf(MockOperation);
      expect(operation._mockName).toBe("testOp");
      expect(operation._mockIndex).toBe(2);
      expect(mockOperationStorage.registerOperation).toHaveBeenCalledWith(
        operation
      );
    });

    it("should create and register mock operation by ID", () => {
      const runner = new LocalDurableTestRunner<{ success: boolean }>({
        handlerFunction: mockHandlerFunction,
      });

      const operation = runner.getOperationById("op-123");

      expect(operation).toBeInstanceOf(MockOperation);
      expect(operation._mockId).toBe("op-123");
      expect(mockOperationStorage.registerOperation).toHaveBeenCalledWith(
        operation
      );
    });
  });

  describe("static environment methods", () => {
    describe("setupTestEnvironment", () => {
      it("should delegate to CheckpointServerWorkerManager.getInstance().setup()", async () => {
        const expectedResult = {
          url: "http://127.0.0.1:9999",
          port: 9999,
        };
        mockCheckpointServerWorkerManager.setup.mockResolvedValue(
          expectedResult
        );

        const result = await LocalDurableTestRunner.setupTestEnvironment();

        expect(CheckpointServerWorkerManager.getInstance).toHaveBeenCalled();
        expect(mockCheckpointServerWorkerManager.setup).toHaveBeenCalled();
        expect(result).toEqual(expectedResult);
      });

      it("should propagate setup errors", async () => {
        const setupError = new Error("Failed to start checkpoint server");
        mockCheckpointServerWorkerManager.setup.mockRejectedValue(setupError);

        await expect(
          LocalDurableTestRunner.setupTestEnvironment()
        ).rejects.toThrow("Failed to start checkpoint server");

        expect(CheckpointServerWorkerManager.getInstance).toHaveBeenCalled();
        expect(mockCheckpointServerWorkerManager.setup).toHaveBeenCalled();
      });
    });

    describe("teardownTestEnvironment", () => {
      it("should delegate to CheckpointServerWorkerManager.getInstance().teardown()", async () => {
        mockCheckpointServerWorkerManager.teardown.mockResolvedValue(undefined);

        await LocalDurableTestRunner.teardownTestEnvironment();

        expect(CheckpointServerWorkerManager.getInstance).toHaveBeenCalled();
        expect(mockCheckpointServerWorkerManager.teardown).toHaveBeenCalled();
      });

      it("should propagate teardown errors", async () => {
        const teardownError = new Error("Failed to shutdown checkpoint server");
        mockCheckpointServerWorkerManager.teardown.mockRejectedValue(
          teardownError
        );

        await expect(
          LocalDurableTestRunner.teardownTestEnvironment()
        ).rejects.toThrow("Failed to shutdown checkpoint server");

        expect(CheckpointServerWorkerManager.getInstance).toHaveBeenCalled();
        expect(mockCheckpointServerWorkerManager.teardown).toHaveBeenCalled();
      });
    });

    describe("environment lifecycle integration", () => {
      it("should allow setup and teardown to be called in sequence", async () => {
        const setupResult = { url: "http://127.0.0.1:8888", port: 8888 };
        mockCheckpointServerWorkerManager.setup.mockResolvedValue(setupResult);
        mockCheckpointServerWorkerManager.teardown.mockResolvedValue(undefined);

        // Setup
        const result = await LocalDurableTestRunner.setupTestEnvironment();
        expect(result).toEqual(setupResult);

        // Teardown
        await LocalDurableTestRunner.teardownTestEnvironment();

        expect(mockCheckpointServerWorkerManager.setup).toHaveBeenCalledTimes(
          1
        );
        expect(
          mockCheckpointServerWorkerManager.teardown
        ).toHaveBeenCalledTimes(1);
      });
    });
  });
});
