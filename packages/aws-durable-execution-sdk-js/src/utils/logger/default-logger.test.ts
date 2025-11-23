import { DurableLogData, DurableLogLevel } from "../../types";
import { createDefaultLogger } from "./default-logger";
import { Console } from "node:console";

// Mock the Console constructor
jest.mock("node:console", () => {
  const mockConsole = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  return {
    Console: jest.fn().mockImplementation(() => mockConsole),
  };
});

describe("Default Logger", () => {
  let mockConsole: any;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Store original environment variable
    originalEnv = process.env["AWS_LAMBDA_LOG_LEVEL"];

    // Get the mocked console instance
    mockConsole = new (Console as any)();

    // Clear all mocks
    jest.clearAllMocks();

    // Mock Date.now to have consistent timestamps in tests
    jest
      .spyOn(Date.prototype, "toISOString")
      .mockReturnValue("2025-11-21T18:33:33.938Z");
  });

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv !== undefined) {
      process.env["AWS_LAMBDA_LOG_LEVEL"] = originalEnv;
    } else {
      delete process.env["AWS_LAMBDA_LOG_LEVEL"];
    }

    jest.restoreAllMocks();
  });

  it("should create a logger with all required methods", () => {
    const logger = createDefaultLogger();

    expect(logger).toHaveProperty("log");
    expect(logger).toHaveProperty("info");
    expect(logger).toHaveProperty("error");
    expect(logger).toHaveProperty("warn");
    expect(logger).toHaveProperty("debug");
  });

  describe("log method", () => {
    it("should format and output structured JSON for each log level", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.INFO,
      };

      logger.log?.(DurableLogLevel.DEBUG, durableLogData, "debug message");
      logger.log?.(DurableLogLevel.INFO, durableLogData, "info message");
      logger.log?.(DurableLogLevel.WARN, durableLogData, "warn message");
      logger.log?.(DurableLogLevel.ERROR, durableLogData, "error message");

      expect(mockConsole.debug).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.DEBUG,
          executionArn: "test-arn",
          operationId: "abc123",
          message: "debug message",
        }),
      );

      expect(mockConsole.info).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.INFO,
          executionArn: "test-arn",
          operationId: "abc123",
          message: "info message",
        }),
      );

      expect(mockConsole.warn).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.WARN,
          executionArn: "test-arn",
          operationId: "abc123",
          message: "warn message",
        }),
      );

      expect(mockConsole.error).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.ERROR,
          executionArn: "test-arn",
          operationId: "abc123",
          message: "error message",
        }),
      );
    });

    it("should include tenantId when provided", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        tenantId: "test-tenant",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.INFO,
      };

      logger.log?.(DurableLogLevel.INFO, durableLogData, "test message");

      expect(mockConsole.info).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.INFO,
          executionArn: "test-arn",
          tenantId: "test-tenant",
          operationId: "abc123",
          message: "test message",
        }),
      );
    });

    it("should include attempt field when provided", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "retry-step",
        attempt: 2,
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.INFO,
      };

      logger.log?.(
        DurableLogLevel.INFO,
        durableLogData,
        "retry attempt message",
      );

      expect(mockConsole.info).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.INFO,
          executionArn: "test-arn",
          operationId: "retry-step",
          attempt: 2,
          message: "retry attempt message",
        }),
      );
    });

    it("should omit operationId and attempt when undefined", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: undefined,
        attempt: undefined,
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.INFO,
      };

      logger.log?.(DurableLogLevel.INFO, durableLogData, "test message");

      expect(mockConsole.info).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.INFO,
          executionArn: "test-arn",
          message: "test message",
        }),
      );
    });

    it("should handle multiple message parameters with util.format", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.INFO,
      };

      logger.log?.(
        DurableLogLevel.INFO,
        durableLogData,
        "Hello %s",
        "world",
        123,
      );

      expect(mockConsole.info).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.INFO,
          executionArn: "test-arn",
          operationId: "abc123",
          message: "Hello world 123",
        }),
      );
    });

    it("should handle Error objects and extract error information", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.ERROR,
      };
      const error = new Error("Test error");
      error.stack = "Error: Test error\n    at test.js:1:1";

      logger.log?.(
        DurableLogLevel.ERROR,
        durableLogData,
        "Error occurred:",
        error,
      );

      const expectedCall = mockConsole.error.mock.calls[0][0];
      const parsedLog = JSON.parse(expectedCall);

      expect(parsedLog).toMatchObject({
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.ERROR,
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        message: "Error occurred: Error: Test error\n    at test.js:1:1",
        errorType: "Error",
        errorMessage: "Test error",
        stackTrace: ["Error: Test error", "    at test.js:1:1"],
      });
    });

    it("should handle single parameter that is an Error object", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.ERROR,
      };
      const error = new Error("Test error");
      error.stack = "Error: Test error\n    at test.js:1:1";

      logger.log?.(DurableLogLevel.ERROR, durableLogData, error);

      const expectedCall = mockConsole.error.mock.calls[0][0];
      const parsedLog = JSON.parse(expectedCall);

      expect(parsedLog).toMatchObject({
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.ERROR,
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        message: {
          errorType: "Error",
          errorMessage: "Test error",
          stackTrace: ["Error: Test error", "    at test.js:1:1"],
        },
      });
    });

    it("should default to INFO level for unknown log levels", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.INFO,
      };

      logger.log?.(
        "UNKNOWN" as DurableLogLevel,
        durableLogData,
        "test message",
      );

      expect(mockConsole.info).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.INFO,
          executionArn: "test-arn",
          operationId: "abc123",
          message: "test message",
        }),
      );
    });

    it("should handle JSON stringify errors and fall back to util.format", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.INFO,
      };

      // Create an object with circular reference to trigger stringify error
      const circularObj: any = { name: "circular" };
      circularObj.self = circularObj;

      logger.log?.(DurableLogLevel.INFO, durableLogData, circularObj);

      // Should fall back to util.format and stringify without error replacer
      // util.format handles circular references with a detailed representation
      expect(mockConsole.info).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.INFO,
          executionArn: "test-arn",
          operationId: "abc123",
          message: "<ref *1> { name: 'circular', self: [Circular *1] }",
        }),
      );
    });

    it("should handle Error objects with no constructor name", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.ERROR,
      };

      // Create error with no constructor name
      const errorWithoutConstructor = Object.create(Error.prototype);
      errorWithoutConstructor.message = "Test error";
      errorWithoutConstructor.stack = "Test error\n    at test.js:1:1";
      errorWithoutConstructor.constructor = null;

      logger.log?.(
        DurableLogLevel.ERROR,
        durableLogData,
        errorWithoutConstructor,
      );

      const expectedCall = mockConsole.error.mock.calls[0][0];
      const parsedLog = JSON.parse(expectedCall);

      expect(parsedLog).toMatchObject({
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.ERROR,
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        message: {
          errorType: "UnknownError",
          errorMessage: "Test error",
          stackTrace: ["Test error", "    at test.js:1:1"],
        },
      });
    });

    it("should handle Error objects with non-string stack", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.ERROR,
      };

      // Create error with non-string stack
      const errorWithArrayStack = new Error("Test error");
      errorWithArrayStack.stack = [
        "Error: Test error",
        "    at test.js:1:1",
      ] as any;

      logger.log?.(DurableLogLevel.ERROR, durableLogData, errorWithArrayStack);

      const expectedCall = mockConsole.error.mock.calls[0][0];
      const parsedLog = JSON.parse(expectedCall);

      expect(parsedLog).toMatchObject({
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.ERROR,
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        message: {
          errorType: "Error",
          errorMessage: "Test error",
          stackTrace: ["Error: Test error", "    at test.js:1:1"],
        },
      });
    });

    it("should handle tenantId as null", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        tenantId: null as any,
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.INFO,
      };

      logger.log?.(DurableLogLevel.INFO, durableLogData, "test message");

      expect(mockConsole.info).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.INFO,
          executionArn: "test-arn",
          operationId: "abc123",
          message: "test message",
        }),
      );
    });

    it("should handle Error with no constructor in multi-param case", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.ERROR,
      };

      // Create error with no constructor name
      const errorWithoutConstructor = Object.create(Error.prototype);
      errorWithoutConstructor.message = "Test error";
      errorWithoutConstructor.stack = "Test error\n    at test.js:1:1";
      errorWithoutConstructor.constructor = null;

      logger.log?.(
        DurableLogLevel.ERROR,
        durableLogData,
        "Error occurred:",
        errorWithoutConstructor,
      );

      const expectedCall = mockConsole.error.mock.calls[0][0];
      const parsedLog = JSON.parse(expectedCall);

      expect(parsedLog).toMatchObject({
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.ERROR,
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        message:
          "Error occurred: Error {\n  message: 'Test error',\n  stack: 'Test error\\n    at test.js:1:1',\n  constructor: null\n}",
        errorType: "UnknownError",
        errorMessage: "Test error",
        stackTrace: ["Test error", "    at test.js:1:1"],
      });
    });

    it("should handle Error with non-string stack in multi-param case", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.ERROR,
      };

      // Create error with non-string stack
      const errorWithArrayStack = new Error("Test error");
      errorWithArrayStack.stack = undefined as any;

      logger.log?.(
        DurableLogLevel.ERROR,
        durableLogData,
        "Error occurred:",
        errorWithArrayStack,
      );

      const expectedCall = mockConsole.error.mock.calls[0][0];
      const parsedLog = JSON.parse(expectedCall);

      expect(parsedLog).toMatchObject({
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.ERROR,
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        message: "Error occurred: [Error: Test error]",
        errorType: "Error",
        errorMessage: "Test error",
        stackTrace: [],
      });
    });
  });

  describe("log level filtering", () => {
    it("should enable all methods when AWS_LAMBDA_LOG_LEVEL is DEBUG", () => {
      process.env["AWS_LAMBDA_LOG_LEVEL"] = "DEBUG";
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.DEBUG,
      };

      logger.debug?.(durableLogData, "debug message");
      logger.info?.(durableLogData, "info message");
      logger.warn?.(durableLogData, "warn message");
      logger.error?.(durableLogData, "error message");

      expect(mockConsole.debug).toHaveBeenCalled();
      expect(mockConsole.info).toHaveBeenCalled();
      expect(mockConsole.warn).toHaveBeenCalled();
      expect(mockConsole.error).toHaveBeenCalled();
    });

    it("should disable debug when AWS_LAMBDA_LOG_LEVEL is INFO", () => {
      process.env["AWS_LAMBDA_LOG_LEVEL"] = "INFO";
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.INFO,
      };

      logger.debug?.(durableLogData, "debug message");
      logger.info?.(durableLogData, "info message");
      logger.warn?.(durableLogData, "warn message");
      logger.error?.(durableLogData, "error message");

      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.info).toHaveBeenCalled();
      expect(mockConsole.warn).toHaveBeenCalled();
      expect(mockConsole.error).toHaveBeenCalled();
    });

    it("should disable debug and info when AWS_LAMBDA_LOG_LEVEL is WARN", () => {
      process.env["AWS_LAMBDA_LOG_LEVEL"] = "WARN";
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.WARN,
      };

      logger.debug?.(durableLogData, "debug message");
      logger.info?.(durableLogData, "info message");
      logger.warn?.(durableLogData, "warn message");
      logger.error?.(durableLogData, "error message");

      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.info).not.toHaveBeenCalled();
      expect(mockConsole.warn).toHaveBeenCalled();
      expect(mockConsole.error).toHaveBeenCalled();
    });

    it("should only enable error when AWS_LAMBDA_LOG_LEVEL is ERROR", () => {
      process.env["AWS_LAMBDA_LOG_LEVEL"] = "ERROR";
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.ERROR,
      };

      logger.debug?.(durableLogData, "debug message");
      logger.info?.(durableLogData, "info message");
      logger.warn?.(durableLogData, "warn message");
      logger.error?.(durableLogData, "error message");

      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.info).not.toHaveBeenCalled();
      expect(mockConsole.warn).not.toHaveBeenCalled();
      expect(mockConsole.error).toHaveBeenCalled();
    });

    it("should default to DEBUG level when AWS_LAMBDA_LOG_LEVEL is invalid", () => {
      process.env["AWS_LAMBDA_LOG_LEVEL"] = "INVALID";
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.DEBUG,
      };

      logger.debug?.(durableLogData, "debug message");

      expect(mockConsole.debug).toHaveBeenCalled();
    });

    it("should default to DEBUG level when AWS_LAMBDA_LOG_LEVEL is not set", () => {
      delete process.env["AWS_LAMBDA_LOG_LEVEL"];
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.DEBUG,
      };

      logger.debug?.(durableLogData, "debug message");

      expect(mockConsole.debug).toHaveBeenCalled();
    });
  });

  describe("individual logging methods output format", () => {
    it("should format output correctly for each individual method", () => {
      const logger = createDefaultLogger();
      const durableLogData: DurableLogData = {
        requestId: "mock-request-id",
        executionArn: "test-arn",
        operationId: "abc123",
        timestamp: "2025-11-21T18:33:33.938Z",
        level: DurableLogLevel.INFO,
      };

      logger.info?.(durableLogData, "info message");
      logger.error?.(durableLogData, "error message");
      logger.warn?.(durableLogData, "warn message");
      logger.debug?.(durableLogData, "debug message");

      expect(mockConsole.info).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.INFO,
          executionArn: "test-arn",
          operationId: "abc123",
          message: "info message",
        }),
      );

      expect(mockConsole.error).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.ERROR,
          executionArn: "test-arn",
          operationId: "abc123",
          message: "error message",
        }),
      );

      expect(mockConsole.warn).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.WARN,
          executionArn: "test-arn",
          operationId: "abc123",
          message: "warn message",
        }),
      );

      expect(mockConsole.debug).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: "mock-request-id",
          timestamp: "2025-11-21T18:33:33.938Z",
          level: DurableLogLevel.DEBUG,
          executionArn: "test-arn",
          operationId: "abc123",
          message: "debug message",
        }),
      );
    });
  });
});
