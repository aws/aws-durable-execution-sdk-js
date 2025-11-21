import { ExecutionStatus } from "@aws-sdk/client-lambda";
import {
  DurableExecutionInvocationInput,
  LambdaHandler,
} from "@aws/durable-execution-sdk-js";
import { Handler } from "aws-lambda";
import {
  FunctionStorage,
  HandlerData,
  FunctionNameMap,
} from "../function-storage";
import { InvokeHandler } from "../../invoke-handler";
import {
  ILocalDurableTestRunnerExecutor,
  ILocalDurableTestRunnerFactory,
} from "../../interfaces/durable-test-runner-factory";

// Mock dependencies
jest.mock("../../invoke-handler");

describe("FunctionStorage", () => {
  let functionStorage: FunctionStorage;
  let mockLocalDurableTestRunner: jest.Mocked<
    ILocalDurableTestRunnerExecutor<unknown>
  >;
  let mockInvokeHandler: jest.Mocked<InvokeHandler>;
  let mockDurableHandler: jest.MockedFunction<
    LambdaHandler<DurableExecutionInvocationInput>
  >;
  let mockNonDurableHandler: jest.MockedFunction<Handler>;
  let mockFactory: jest.Mocked<ILocalDurableTestRunnerFactory>;

  // Helper function to create mock execution objects
  const createMockExecution = (
    overrides: Partial<{
      status: ExecutionStatus;
      result: unknown;
      error: unknown;
    }> = {},
  ) => ({
    getStatus: jest
      .fn()
      .mockReturnValue(overrides.status ?? ExecutionStatus.SUCCEEDED),
    getResult: jest.fn().mockReturnValue(overrides.result ?? { success: true }),
    getError: jest.fn().mockReturnValue(overrides.error),
    getOperations: jest.fn().mockReturnValue([]),
    getInvocations: jest.fn().mockReturnValue([]),
    getHistoryEvents: jest.fn().mockReturnValue([]),
    print: jest.fn(),
  });

  // Helper function to setup durable function registration
  const setupDurableFunction = (functionName = "durable-function") => {
    functionStorage.registerDurableFunction(functionName, mockDurableHandler);
  };

  // Helper function to setup non-durable function registration
  const setupNonDurableFunction = (functionName = "non-durable-function") => {
    functionStorage.registerFunction(functionName, mockNonDurableHandler);
  };

  beforeEach(() => {
    jest.resetAllMocks();

    mockLocalDurableTestRunner = {
      run: jest.fn().mockResolvedValue(createMockExecution()),
    };

    // Create a mock factory for FunctionStorage
    mockFactory = {
      createRunner: jest.fn().mockReturnValue(mockLocalDurableTestRunner),
    };

    functionStorage = new FunctionStorage(mockFactory);

    // Mock InvokeHandler
    mockInvokeHandler = {
      buildContext: jest.fn().mockReturnValue({
        functionName: "test-function",
        awsRequestId: "test-request-id",
        getRemainingTimeInMillis: () => 30000,
      }),
    } as unknown as jest.Mocked<InvokeHandler>;

    (InvokeHandler as jest.Mock).mockImplementation(() => mockInvokeHandler);

    // Mock handlers
    mockDurableHandler = jest.fn();
    mockNonDurableHandler = jest.fn();
  });

  describe("registerDurableFunction", () => {
    it("should register durable function handler correctly", () => {
      setupDurableFunction("test-durable-function");

      // Since the functionNameMap is private, we can test it through runHandler
      expect(() =>
        functionStorage.runHandler("test-durable-function", "{}"),
      ).not.toThrow();
    });

    it("should overwrite previously registered durable functions", async () => {
      const newHandler = jest.fn() as jest.MockedFunction<
        LambdaHandler<DurableExecutionInvocationInput>
      >;

      setupDurableFunction("test-function");
      functionStorage.registerDurableFunction("test-function", newHandler);

      // The new handler should be used
      const mockExecution = createMockExecution();
      mockLocalDurableTestRunner.run.mockResolvedValue(mockExecution);

      await functionStorage.runHandler("test-function", "{}");

      expect(mockFactory.createRunner).toHaveBeenCalledWith({
        handlerFunction: newHandler,
      });
    });
  });

  describe("registerFunction", () => {
    it("should register non-durable function handler correctly", () => {
      setupNonDurableFunction("test-non-durable-function");

      // Since the functionNameMap is private, we can test it through runHandler
      expect(() =>
        functionStorage.runHandler("test-non-durable-function", "{}"),
      ).not.toThrow();
    });

    it("should overwrite previously registered non-durable functions", async () => {
      const newHandler = jest.fn() as jest.MockedFunction<Handler>;
      newHandler.mockImplementation((_event, _context, callback) => {
        callback(null, { message: "new handler result" });
      });

      setupNonDurableFunction("test-function");
      functionStorage.registerFunction("test-function", newHandler);

      const result = await functionStorage.runHandler("test-function", "{}");

      expect(newHandler).toHaveBeenCalled();
      expect(result).toEqual({
        result: JSON.stringify({ message: "new handler result" }),
      });
    });
  });

  describe("runHandler - durable functions", () => {
    beforeEach(() => {
      setupDurableFunction();
    });

    it("should run durable handler successfully with SUCCEEDED status", async () => {
      const mockResult = { success: true, data: "test-data" };
      const mockExecution = createMockExecution({
        status: ExecutionStatus.SUCCEEDED,
        result: mockResult,
      });

      mockLocalDurableTestRunner.run.mockResolvedValue(mockExecution);

      const result = await functionStorage.runHandler(
        "durable-function",
        '{"input": "test"}',
      );

      expect(mockFactory.createRunner).toHaveBeenCalledWith({
        handlerFunction: mockDurableHandler,
      });
      expect(mockLocalDurableTestRunner.run).toHaveBeenCalledWith({
        payload: { input: "test" },
      });
      expect(result).toEqual({
        result: JSON.stringify(mockResult),
        error: undefined,
      });
    });

    it("should handle durable handler with undefined payload", async () => {
      const mockExecution = createMockExecution();
      mockLocalDurableTestRunner.run.mockResolvedValue(mockExecution);

      await functionStorage.runHandler("durable-function", undefined);

      expect(mockLocalDurableTestRunner.run).toHaveBeenCalledWith({
        payload: undefined,
      });
    });

    it("should handle durable handler with FAILED status", async () => {
      const mockError = {
        errorData: "error-data",
        errorMessage: "Execution failed",
        errorType: "CustomError",
        stackTrace: ["line1", "line2"],
      };

      const mockExecution = createMockExecution({
        status: ExecutionStatus.FAILED,
        error: mockError,
      });

      mockLocalDurableTestRunner.run.mockResolvedValue(mockExecution);

      const result = await functionStorage.runHandler(
        "durable-function",
        '{"input": "test"}',
      );

      expect(result).toEqual({
        result: undefined,
        error: {
          ErrorData: "error-data",
          ErrorMessage: "Execution failed",
          ErrorType: "CustomError",
          StackTrace: ["line1", "line2"],
        },
      });
    });

    it("should handle durable handler with TIMED_OUT status", async () => {
      const mockError = {
        errorData: "timeout-data",
        errorMessage: "Execution timed out",
        errorType: "TimeoutError",
        stackTrace: ["timeout line"],
      };

      const mockExecution = createMockExecution({
        status: ExecutionStatus.TIMED_OUT,
        error: mockError,
      });

      mockLocalDurableTestRunner.run.mockResolvedValue(mockExecution);

      const result = await functionStorage.runHandler(
        "durable-function",
        '{"input": "test"}',
      );

      expect(result).toEqual({
        result: undefined,
        error: {
          ErrorData: "timeout-data",
          ErrorMessage: "Execution timed out",
          ErrorType: "TimeoutError",
          StackTrace: ["timeout line"],
        },
      });
    });

    it("should throw error if durable execution status is RUNNING", async () => {
      const mockExecution = createMockExecution({
        status: ExecutionStatus.RUNNING,
      });
      mockLocalDurableTestRunner.run.mockResolvedValue(mockExecution);

      await expect(
        functionStorage.runHandler("durable-function", '{"input": "test"}'),
      ).rejects.toThrow(
        "Invalid execution status for completed handler: RUNNING",
      );
    });
  });

  describe("runHandler - non-durable functions", () => {
    beforeEach(() => {
      setupNonDurableFunction();
    });

    it("should run non-durable handler successfully with callback", async () => {
      const mockResult = { success: true, message: "completed" };

      mockNonDurableHandler.mockImplementation((_event, _context, callback) => {
        callback(null, mockResult);
      });

      const result = await functionStorage.runHandler(
        "non-durable-function",
        '{"input": "test"}',
      );

      expect(mockNonDurableHandler).toHaveBeenCalledWith(
        { input: "test" },
        expect.objectContaining({
          functionName: "test-function",
          awsRequestId: "test-request-id",
        }),
        expect.any(Function),
      );
      expect(result).toEqual({
        result: JSON.stringify(mockResult),
      });
    });

    it("should run non-durable handler successfully with promise return", async () => {
      const mockResult = { success: true, message: "completed" };

      mockNonDurableHandler.mockImplementation(() => {
        return Promise.resolve(mockResult);
      });

      const result = await functionStorage.runHandler(
        "non-durable-function",
        '{"input": "test"}',
      );

      expect(result).toEqual({
        result: JSON.stringify(mockResult),
      });
    });

    it("should handle non-durable handler with undefined payload", async () => {
      const mockResult = { success: true };

      mockNonDurableHandler.mockImplementation((_event, _context, callback) => {
        callback(null, mockResult);
      });

      await functionStorage.runHandler("non-durable-function", undefined);

      expect(mockNonDurableHandler).toHaveBeenCalledWith(
        {},
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("should handle non-durable handler error via callback", async () => {
      const mockError = new Error("Handler failed");

      mockNonDurableHandler.mockImplementation((_event, _context, callback) => {
        callback(mockError);
      });

      const result = await functionStorage.runHandler(
        "non-durable-function",
        '{"input": "test"}',
      );

      expect(result).toEqual({
        error: {
          ErrorMessage: "Handler failed",
          ErrorType: "Error",
          StackTrace: expect.arrayContaining([expect.any(String)]),
        },
      });
    });

    it("should handle non-durable handler error via callback with string error", async () => {
      const mockError = "String error message";

      mockNonDurableHandler.mockImplementation((_event, _context, callback) => {
        callback(mockError);
      });

      const result = await functionStorage.runHandler(
        "non-durable-function",
        '{"input": "test"}',
      );

      expect(result).toEqual({
        error: expect.objectContaining({
          ErrorMessage: "String error message",
          ErrorType: "Error",
        }),
      });
    });

    it("should handle non-durable handler error via promise rejection", async () => {
      const mockError = new Error("Promise rejection");

      mockNonDurableHandler.mockImplementation(() => {
        return Promise.reject(mockError);
      });

      const result = await functionStorage.runHandler(
        "non-durable-function",
        '{"input": "test"}',
      );

      expect(result).toEqual({
        error: {
          ErrorMessage: "Promise rejection",
          ErrorType: "Error",
          StackTrace: expect.any(Array),
        },
      });
    });

    it("should handle non-durable handler error via thrown exception", async () => {
      const mockError = new Error("Thrown exception");

      mockNonDurableHandler.mockImplementation(() => {
        throw mockError;
      });

      const result = await functionStorage.runHandler(
        "non-durable-function",
        '{"input": "test"}',
      );

      expect(result).toEqual({
        error: {
          ErrorMessage: "Thrown exception",
          ErrorType: "Error",
          StackTrace: expect.any(Array),
        },
      });
    });

    it("should handle non-Error exceptions", async () => {
      const mockError = "Non-Error exception";

      mockNonDurableHandler.mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw mockError;
      });

      const result = await functionStorage.runHandler(
        "non-durable-function",
        '{"input": "test"}',
      );

      expect(result).toEqual({
        error: {
          ErrorMessage: "Non-Error exception",
        },
      });
    });
  });

  describe("runHandler - error cases", () => {
    it("should throw error when function is not found", async () => {
      await expect(
        functionStorage.runHandler(
          "non-existent-function",
          '{"input": "test"}',
        ),
      ).rejects.toThrow(
        "No function found for function name non-existent-function.\n" +
          'Please configure the function handler for "non-existent-function" with LocalDurableTestRunner.registerFunctions.',
      );
    });

    it("should throw error when function map is empty", async () => {
      await expect(
        functionStorage.runHandler("any-function", '{"input": "test"}'),
      ).rejects.toThrow(
        "No function found for function name any-function.\n" +
          'Please configure the function handler for "any-function" with LocalDurableTestRunner.registerFunctions.',
      );
    });
  });

  describe("type definitions", () => {
    it("should correctly type HandlerData for durable functions", () => {
      const durableHandlerData: HandlerData = {
        isDurable: true,
        handler: mockDurableHandler,
      };

      expect(durableHandlerData.isDurable).toBe(true);
      expect(durableHandlerData.handler).toBe(mockDurableHandler);
    });

    it("should correctly type HandlerData for non-durable functions", () => {
      const nonDurableHandlerData: HandlerData = {
        isDurable: false,
        handler: mockNonDurableHandler,
      };

      expect(nonDurableHandlerData.isDurable).toBe(false);
      expect(nonDurableHandlerData.handler).toBe(mockNonDurableHandler);
    });

    it("should correctly type FunctionNameMap", () => {
      const functionNameMap: FunctionNameMap = {
        "durable-func": {
          isDurable: true,
          handler: mockDurableHandler,
        },
        "non-durable-func": {
          isDurable: false,
          handler: mockNonDurableHandler,
        },
      };

      expect(Object.keys(functionNameMap)).toEqual([
        "durable-func",
        "non-durable-func",
      ]);
      expect(functionNameMap["durable-func"].isDurable).toBe(true);
      expect(functionNameMap["non-durable-func"].isDurable).toBe(false);
    });
  });
});
