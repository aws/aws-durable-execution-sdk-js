import { TestResult } from "../../../../test-runner";
import { logExecutionStart, logExecutionResults } from "../output";

describe("Output Functions", () => {
  const originalConsoleLog = console.log;
  const originalConsoleTable = console.table;
  const mockConsoleLog = jest.fn();
  const mockConsoleTable = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = mockConsoleLog;
    console.table = mockConsoleTable;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.table = originalConsoleTable;
  });

  describe("logExecutionStart", () => {
    it("should log basic execution configuration", () => {
      const options = {
        filePath: "test.js",
        skipTime: false,
        verbose: false,
        showHistory: false,
      };

      logExecutionStart(options);

      expect(mockConsoleLog).toHaveBeenNthCalledWith(
        1,
        "Running durable function from: test.js",
      );
      expect(mockConsoleLog).toHaveBeenNthCalledWith(
        2,
        "Skip time: false, Verbose: false, Show history: false\n",
      );
      expect(mockConsoleLog).toHaveBeenCalledTimes(2);
    });

    it("should log configuration with all options enabled", () => {
      const options = {
        filePath: "complex-handler.js",
        skipTime: true,
        verbose: true,
        showHistory: true,
      };

      logExecutionStart(options);

      expect(mockConsoleLog).toHaveBeenNthCalledWith(
        1,
        "Running durable function from: complex-handler.js",
      );
      expect(mockConsoleLog).toHaveBeenNthCalledWith(
        2,
        "Skip time: true, Verbose: true, Show history: true\n",
      );
    });
  });

  describe("logExecutionResults", () => {
    it("should log execution results with history when enabled", () => {
      const mockExecution: TestResult = {
        print: jest.fn(),
        getStatus: jest.fn().mockReturnValue("SUCCEEDED"),
        getHistoryEvents: jest.fn().mockReturnValue([
          { EventType: "ExecutionStarted", EventId: 1 },
          { EventType: "ExecutionSucceeded", EventId: 2 },
        ]),
        getResult: jest.fn().mockReturnValue({ message: "Success" }),
        getError: jest.fn(),
        getOperations: jest.fn(),
        getInvocations: jest.fn(),
      };

      logExecutionResults(mockExecution, true);

      expect(mockExecution.print).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "\nExecution Status:",
        "SUCCEEDED",
      );
      expect(mockConsoleLog).toHaveBeenCalledWith("\nHistory Events:");
      expect(mockConsoleTable).toHaveBeenCalledWith([
        { EventType: "ExecutionStarted", EventId: 1 },
        { EventType: "ExecutionSucceeded", EventId: 2 },
      ]);
      expect(mockConsoleLog).toHaveBeenCalledWith("\nResult:");
      expect(mockConsoleLog).toHaveBeenCalledWith(
        JSON.stringify({ message: "Success" }, null, 2),
      );
    });

    it("should log execution results without history when disabled", () => {
      const mockExecution: TestResult = {
        print: jest.fn(),
        getStatus: jest.fn().mockReturnValue("SUCCEEDED"),
        getHistoryEvents: jest.fn(),
        getResult: jest.fn().mockReturnValue("Simple result"),
        getError: jest.fn(),
        getOperations: jest.fn(),
        getInvocations: jest.fn(),
      };

      logExecutionResults(mockExecution, false);

      expect(mockExecution.print).toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "\nExecution Status:",
        "SUCCEEDED",
      );
      expect(mockConsoleLog).not.toHaveBeenCalledWith("\nHistory Events:");
      expect(mockConsoleTable).not.toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith("\nResult:");
      expect(mockConsoleLog).toHaveBeenCalledWith(
        JSON.stringify("Simple result", null, 2),
      );
    });

    it("should log error when getResult throws", () => {
      const mockExecution: TestResult = {
        print: jest.fn(),
        getStatus: jest.fn().mockReturnValue("FAILED"),
        getHistoryEvents: jest.fn(),
        getResult: jest.fn().mockImplementation(() => {
          throw new Error("No result available");
        }),
        getError: jest
          .fn()
          .mockReturnValue({ errorType: "TestError", message: "Test failed" }),
        getOperations: jest.fn(),
        getInvocations: jest.fn(),
      };

      logExecutionResults(mockExecution, false);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        "\nExecution Status:",
        "FAILED",
      );
      expect(mockConsoleLog).toHaveBeenCalledWith("\nError:");
      expect(mockConsoleLog).toHaveBeenCalledWith(
        JSON.stringify(
          { errorType: "TestError", message: "Test failed" },
          null,
          2,
        ),
      );
      expect(mockConsoleLog).not.toHaveBeenCalledWith("\nResult:");
    });

    it("should call execution print method", () => {
      const mockExecution: TestResult = {
        print: jest.fn(),
        getStatus: jest.fn().mockReturnValue("SUCCEEDED"),
        getHistoryEvents: jest.fn(),
        getResult: jest.fn().mockReturnValue(null),
        getError: jest.fn(),
        getOperations: jest.fn(),
        getInvocations: jest.fn(),
      };

      logExecutionResults(mockExecution, false);

      expect(mockExecution.print).toHaveBeenCalledTimes(1);
    });
  });
});
