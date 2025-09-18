import {
  LambdaClient,
  Invoke20150331Command,
  GetDurableExecutionCommand,
  GetDurableExecutionHistoryCommand,
  GetDurableExecutionHistoryResponse,
  LambdaClientConfig,
  EventType,
} from "@aws-sdk/client-lambda";
import { CloudDurableTestRunner } from "../cloud-durable-test-runner";
import {
  OperationWithData,
  OperationEvents,
} from "../../common/operations/operation-with-data";
import { IndexedOperations } from "../../common/indexed-operations";
import { OperationStorage } from "../../common/operation-storage";
import { OperationWaitManager } from "../../local/operations/operation-wait-manager";
import { ResultFormatter } from "../../local/result-formatter";
import { historyEventsToOperationEvents } from "../utils/process-history-events/process-history-events";

// Mock all dependencies
jest.mock("@aws-sdk/client-lambda");
jest.mock("../../common/indexed-operations");
jest.mock("../../common/operation-storage");
jest.mock("../../local/operations/operation-wait-manager");
jest.mock("../../local/result-formatter");
jest.mock("../../common/operations/operation-with-data");
jest.mock("../utils/process-history-events/process-history-events");

describe("CloudDurableTestRunner", () => {
  let mockLambdaClient: jest.Mocked<LambdaClient>;
  let mockResultFormatter: jest.Mocked<ResultFormatter<{ success: boolean }>>;
  let mockWaitManager: jest.Mocked<OperationWaitManager>;
  let mockIndexedOperations: jest.Mocked<IndexedOperations>;
  let mockOperationStorage: jest.Mocked<OperationStorage>;
  let mockOperationWithData: jest.Mocked<OperationWithData>;

  const mockFunctionArn =
    "arn:aws:lambda:us-east-1:123456789012:function:test-function";
  const mockExecutionArn =
    "arn:aws:lambda:us-east-1:123456789012:execution:test-execution";

  beforeEach(() => {
    jest.resetAllMocks();

    // Mock LambdaClient
    mockLambdaClient = {
      send: jest.fn(),
    } as unknown as jest.Mocked<LambdaClient>;

    (LambdaClient as jest.Mock).mockImplementation(() => mockLambdaClient);

    // Mock ResultFormatter
    mockResultFormatter = {
      formatTestResult: jest.fn().mockReturnValue({
        getOperations: jest.fn().mockReturnValue([]),
        getInvocations: jest.fn().mockReturnValue([]),
        getResult: jest.fn().mockReturnValue({ data: { success: true } }),
        getError: jest.fn(),
      }),
    } as unknown as jest.Mocked<ResultFormatter<{ success: boolean }>>;

    (ResultFormatter as jest.Mock).mockImplementation(
      () => mockResultFormatter
    );

    // Mock OperationWaitManager
    mockWaitManager = {
      waitForOperation: jest.fn(),
      clearWaitingOperations: jest.fn(),
      handleCheckpointReceived: jest.fn(),
    } as unknown as jest.Mocked<OperationWaitManager>;

    (OperationWaitManager as jest.Mock).mockImplementation(
      () => mockWaitManager
    );

    // Mock IndexedOperations
    mockIndexedOperations = {
      getByIndex: jest.fn(),
      getByNameAndIndex: jest.fn(),
      getById: jest.fn(),
    } as unknown as jest.Mocked<IndexedOperations>;

    (IndexedOperations as jest.Mock).mockImplementation(
      () => mockIndexedOperations
    );

    // Mock OperationStorage
    mockOperationStorage = {
      populateOperations: jest.fn(),
      registerOperation: jest.fn(),
    } as unknown as jest.Mocked<OperationStorage>;

    (OperationStorage as jest.Mock).mockImplementation(
      () => mockOperationStorage
    );

    // Mock OperationWithData
    mockOperationWithData = {
      getData: jest.fn(),
      getStatus: jest.fn(),
    } as unknown as jest.Mocked<OperationWithData>;

    (OperationWithData as jest.Mock).mockImplementation(
      () => mockOperationWithData
    );

    // Mock historyEventsToOperationEvents
    (historyEventsToOperationEvents as jest.Mock).mockReturnValue([]);
  });

  describe("constructor", () => {
    it("should initialize with required parameters", () => {
      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      expect(runner).toBeDefined();
      expect(LambdaClient).toHaveBeenCalledWith({});
    });

    it("should initialize with custom Lambda client config", () => {
      const customConfig: LambdaClientConfig = {
        region: "us-west-2",
        credentials: {
          accessKeyId: "test-key",
          secretAccessKey: "test-secret",
        },
      };

      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
        config: customConfig,
      });

      expect(runner).toBeDefined();
      expect(LambdaClient).toHaveBeenCalledWith(customConfig);
    });

    it("should initialize all internal dependencies", () => {
      new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      expect(ResultFormatter).toHaveBeenCalled();
      expect(OperationWaitManager).toHaveBeenCalled();
      expect(IndexedOperations).toHaveBeenCalledWith([]);
      expect(OperationStorage).toHaveBeenCalledWith(
        mockWaitManager,
        mockIndexedOperations
      );
    });
  });

  describe("run", () => {
    let runner: CloudDurableTestRunner<{ success: boolean }>;

    beforeEach(() => {
      runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });
    });

    it("should successfully execute a durable function without parameters", async () => {
      const mockInvokeResult = {
        DurableExecutionArn: mockExecutionArn,
      };

      const mockExecutionResult = {
        Status: "SUCCEEDED",
        Result: JSON.stringify({ success: true }),
        Error: undefined,
      };

      const mockHistoryResult: GetDurableExecutionHistoryResponse = {
        Events: [
          {
            EventType: EventType.ExecutionStarted,
            EventTimestamp: new Date(),
          },
        ],
      };

      (mockLambdaClient.send as jest.Mock)
        .mockResolvedValueOnce(mockInvokeResult) // Invoke20150331Command
        .mockResolvedValueOnce(mockExecutionResult) // GetDurableExecutionCommand
        .mockResolvedValueOnce(mockHistoryResult); // GetDurableExecutionHistoryCommand

      const result = await runner.run();

      expect(mockLambdaClient.send).toHaveBeenCalledTimes(3);
      expect(mockLambdaClient.send).toHaveBeenNthCalledWith(
        1,
        expect.any(Invoke20150331Command)
      );
      expect(mockLambdaClient.send).toHaveBeenNthCalledWith(
        2,
        expect.any(GetDurableExecutionCommand)
      );
      expect(mockLambdaClient.send).toHaveBeenNthCalledWith(
        3,
        expect.any(GetDurableExecutionHistoryCommand)
      );

      expect(historyEventsToOperationEvents).toHaveBeenCalledWith(
        mockHistoryResult.Events
      );
      expect(mockOperationStorage.populateOperations).toHaveBeenCalled();
      expect(mockResultFormatter.formatTestResult).toHaveBeenCalledWith(
        {
          status: "SUCCEEDED",
          result: JSON.stringify({ success: true }),
          error: undefined,
        },
        mockOperationStorage,
        []
      );

      expect(result).toBeDefined();
    });

    it("should execute with payload parameters", async () => {
      const testPayload = { input: "test-data", count: 42 };
      const mockInvokeResult = {
        DurableExecutionArn: mockExecutionArn,
      };

      const mockExecutionResult = {
        Status: "SUCCEEDED",
        Result: JSON.stringify({ success: true }),
        Error: undefined,
      };

      const mockHistoryResult: GetDurableExecutionHistoryResponse = {
        Events: [],
      };

      (mockLambdaClient.send as jest.Mock)
        .mockResolvedValueOnce(mockInvokeResult)
        .mockResolvedValueOnce(mockExecutionResult)
        .mockResolvedValueOnce(mockHistoryResult);

      await runner.run({ payload: testPayload });

      // Verify that Invoke20150331Command was called with correct parameters
      expect(Invoke20150331Command).toHaveBeenCalledWith({
        FunctionName: mockFunctionArn,
        Payload: JSON.stringify(testPayload),
      });
    });

    it("should handle execution without payload", async () => {
      const mockInvokeResult = {
        DurableExecutionArn: mockExecutionArn,
      };

      const mockExecutionResult = {
        Status: "SUCCEEDED",
        Result: JSON.stringify({ success: true }),
        Error: undefined,
      };

      const mockHistoryResult: GetDurableExecutionHistoryResponse = {
        Events: [],
      };

      (mockLambdaClient.send as jest.Mock)
        .mockResolvedValueOnce(mockInvokeResult)
        .mockResolvedValueOnce(mockExecutionResult)
        .mockResolvedValueOnce(mockHistoryResult);

      await runner.run();

      // Verify that Invoke20150331Command was called with correct parameters
      expect(Invoke20150331Command).toHaveBeenCalledWith({
        FunctionName: mockFunctionArn,
        Payload: undefined,
      });
    });

    it("should handle failed execution", async () => {
      const mockInvokeResult = {
        DurableExecutionArn: mockExecutionArn,
      };

      const mockExecutionResult = {
        Status: "FAILED",
        Result: undefined,
        Error: {
          errorMessage: "Execution failed",
          errorType: "RuntimeError",
        },
      };

      const mockHistoryResult: GetDurableExecutionHistoryResponse = {
        Events: [],
      };

      (mockLambdaClient.send as jest.Mock)
        .mockResolvedValueOnce(mockInvokeResult)
        .mockResolvedValueOnce(mockExecutionResult)
        .mockResolvedValueOnce(mockHistoryResult);

      const result = await runner.run();

      expect(mockResultFormatter.formatTestResult).toHaveBeenCalledWith(
        {
          status: "FAILED",
          result: undefined,
          error: {
            errorMessage: "Execution failed",
            errorType: "RuntimeError",
          },
        },
        mockOperationStorage,
        []
      );

      expect(result).toBeDefined();
    });

    it("should propagate Lambda client errors", async () => {
      const mockError = new Error("Lambda invocation failed");
      (mockLambdaClient.send as jest.Mock).mockRejectedValue(mockError);

      await expect(runner.run()).rejects.toThrow("Lambda invocation failed");
    });

    it("should handle missing execution ARN", async () => {
      const mockInvokeResult = {
        DurableExecutionArn: undefined,
      };

      (mockLambdaClient.send as jest.Mock).mockResolvedValueOnce(
        mockInvokeResult
      );

      // The code should handle undefined execution ARN by attempting to use it
      // This will likely cause an error when trying to use undefined in subsequent calls
      await expect(runner.run()).rejects.toThrow();
    });

    it("should handle empty history events", async () => {
      const mockInvokeResult = {
        DurableExecutionArn: mockExecutionArn,
      };

      const mockExecutionResult = {
        Status: "SUCCEEDED",
        Result: JSON.stringify({ success: true }),
        Error: undefined,
      };

      const mockHistoryResult: GetDurableExecutionHistoryResponse = {
        Events: undefined,
      };

      (mockLambdaClient.send as jest.Mock)
        .mockResolvedValueOnce(mockInvokeResult)
        .mockResolvedValueOnce(mockExecutionResult)
        .mockResolvedValueOnce(mockHistoryResult);

      await runner.run();

      expect(historyEventsToOperationEvents).toHaveBeenCalledWith([]);
    });
  });

  describe("getHistory", () => {
    it("should return undefined before run is called", () => {
      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      expect(runner.getHistory()).toBeUndefined();
    });

    it("should return history after successful run", async () => {
      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      const mockHistoryResult: GetDurableExecutionHistoryResponse = {
        Events: [
          {
            EventType: EventType.ExecutionStarted,
            EventTimestamp: new Date(),
          },
        ],
      };

      (mockLambdaClient.send as jest.Mock)
        .mockResolvedValueOnce({ DurableExecutionArn: mockExecutionArn })
        .mockResolvedValueOnce({ Status: "SUCCEEDED", Result: "{}" })
        .mockResolvedValueOnce(mockHistoryResult);

      await runner.run();

      expect(runner.getHistory()).toBe(mockHistoryResult);
    });
  });

  describe("operation retrieval methods", () => {
    let runner: CloudDurableTestRunner<{ success: boolean }>;

    beforeEach(() => {
      runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });
    });

    describe("getOperation", () => {
      it("should delegate to getOperationByNameAndIndex with index 0", () => {
        const mockOperation: OperationEvents = {
          operation: { Id: "test-id", Name: "testOp" },
          events: [],
        };
        mockIndexedOperations.getByNameAndIndex.mockReturnValue(mockOperation);

        const result = runner.getOperation("testOp");

        expect(mockIndexedOperations.getByNameAndIndex).toHaveBeenCalledWith(
          "testOp",
          0
        );
        expect(OperationWithData).toHaveBeenCalledWith(
          mockWaitManager,
          mockIndexedOperations,
          mockOperation
        );
        expect(result).toBe(mockOperationWithData);
      });
    });

    describe("getOperationByIndex", () => {
      it("should retrieve operation by index", () => {
        const mockOperation: OperationEvents = {
          operation: { Id: "test-id-2" },
          events: [],
        };
        mockIndexedOperations.getByIndex.mockReturnValue(mockOperation);

        const result = runner.getOperationByIndex(2);

        expect(mockIndexedOperations.getByIndex).toHaveBeenCalledWith(2);
        expect(OperationWithData).toHaveBeenCalledWith(
          mockWaitManager,
          mockIndexedOperations,
          mockOperation
        );
        expect(result).toBe(mockOperationWithData);
      });
    });

    describe("getOperationByNameAndIndex", () => {
      it("should retrieve operation by name and index", () => {
        const mockOperation: OperationEvents = {
          operation: { Id: "test-id-3", Name: "testOp" },
          events: [],
        };
        mockIndexedOperations.getByNameAndIndex.mockReturnValue(mockOperation);

        const result = runner.getOperationByNameAndIndex("testOp", 1);

        expect(mockIndexedOperations.getByNameAndIndex).toHaveBeenCalledWith(
          "testOp",
          1
        );
        expect(OperationWithData).toHaveBeenCalledWith(
          mockWaitManager,
          mockIndexedOperations,
          mockOperation
        );
        expect(result).toBe(mockOperationWithData);
      });
    });

    describe("getOperationById", () => {
      it("should retrieve operation by ID", () => {
        const mockOperation: OperationEvents = {
          operation: { Id: "op-123" },
          events: [],
        };
        mockIndexedOperations.getById.mockReturnValue(mockOperation);

        const result = runner.getOperationById("op-123");

        expect(mockIndexedOperations.getById).toHaveBeenCalledWith("op-123");
        expect(OperationWithData).toHaveBeenCalledWith(
          mockWaitManager,
          mockIndexedOperations,
          mockOperation
        );
        expect(result).toBe(mockOperationWithData);
      });
    });
  });

  describe("error handling", () => {
    let runner: CloudDurableTestRunner<{ success: boolean }>;

    beforeEach(() => {
      runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });
    });

    it("should handle invoke command failure", async () => {
      const invokeError = new Error("Failed to invoke function");
      (mockLambdaClient.send as jest.Mock).mockRejectedValue(invokeError);

      await expect(runner.run()).rejects.toThrow("Failed to invoke function");
    });

    it("should handle get execution command failure", async () => {
      const executionError = new Error("Failed to get execution");
      (mockLambdaClient.send as jest.Mock)
        .mockResolvedValueOnce({ DurableExecutionArn: mockExecutionArn })
        .mockRejectedValue(executionError);

      await expect(runner.run()).rejects.toThrow("Failed to get execution");
    });

    it("should handle get history command failure", async () => {
      const historyError = new Error("Failed to get history");
      (mockLambdaClient.send as jest.Mock)
        .mockResolvedValueOnce({ DurableExecutionArn: mockExecutionArn })
        .mockResolvedValueOnce({ Status: "SUCCEEDED", Result: "{}" })
        .mockRejectedValue(historyError);

      await expect(runner.run()).rejects.toThrow("Failed to get history");
    });

    it("should handle operation retrieval errors gracefully", () => {
      const retrievalError = new Error("Operation not found");
      mockIndexedOperations.getById.mockImplementation(() => {
        throw retrievalError;
      });

      expect(() => runner.getOperationById("non-existent")).toThrow(
        "Operation not found"
      );
    });
  });

  describe("integration scenarios", () => {
    let runner: CloudDurableTestRunner<{ success: boolean }>;

    beforeEach(() => {
      runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });
    });

    it("should handle complex execution with multiple operations", async () => {
      const mockInvokeResult = {
        DurableExecutionArn: mockExecutionArn,
      };

      const mockExecutionResult = {
        Status: "SUCCEEDED",
        Result: JSON.stringify({ success: true, operationCount: 3 }),
        Error: undefined,
      };

      const mockHistoryResult: GetDurableExecutionHistoryResponse = {
        Events: [
          {
            EventType: EventType.ExecutionStarted,
            EventTimestamp: new Date(),
          },
          {
            EventType: EventType.StepStarted,
            EventTimestamp: new Date(),
          },
          {
            EventType: EventType.StepSucceeded,
            EventTimestamp: new Date(),
          },
        ],
      };

      const mockOperationEvents: OperationEvents[] = [
        { operation: { Id: "op1" }, events: [] },
        { operation: { Id: "op2" }, events: [] },
        { operation: { Id: "op3" }, events: [] },
      ];

      (historyEventsToOperationEvents as jest.Mock).mockReturnValue(
        mockOperationEvents
      );

      (mockLambdaClient.send as jest.Mock)
        .mockResolvedValueOnce(mockInvokeResult)
        .mockResolvedValueOnce(mockExecutionResult)
        .mockResolvedValueOnce(mockHistoryResult);

      const result = await runner.run({ payload: { test: "data" } });

      expect(historyEventsToOperationEvents).toHaveBeenCalledWith(
        mockHistoryResult.Events
      );
      expect(mockOperationStorage.populateOperations).toHaveBeenCalledWith(
        mockOperationEvents
      );
      expect(result).toBeDefined();
    });

    it("should maintain state between multiple operation retrievals", () => {
      const mockOp1: OperationEvents = { operation: { Id: "op1" }, events: [] };
      const mockOp2: OperationEvents = { operation: { Id: "op2" }, events: [] };

      mockIndexedOperations.getById
        .mockReturnValueOnce(mockOp1)
        .mockReturnValueOnce(mockOp2);

      const operation1 = runner.getOperationById("op1");
      const operation2 = runner.getOperationById("op2");

      expect(operation1).toBe(mockOperationWithData);
      expect(operation2).toBe(mockOperationWithData);
      expect(OperationWithData).toHaveBeenCalledTimes(2);
    });
  });
});
