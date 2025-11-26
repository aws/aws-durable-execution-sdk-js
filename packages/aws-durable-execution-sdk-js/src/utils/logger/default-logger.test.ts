import { DurableLogData, DurableLogLevel } from "../../types";
import {
  createDefaultLogger,
  DefaultLogger,
  LoggingExecutionContext,
} from "./default-logger";
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

  const loggingExecutionContext: LoggingExecutionContext = {
    durableExecutionArn: "durable-execution-arn",
    requestId: "request-id",
    tenantId: undefined,
  };

  describe("createDefaultLogger function", () => {
    it("should create a logger with all required methods", () => {
      const logger = createDefaultLogger(loggingExecutionContext);

      expect(logger).toHaveProperty("log");
      expect(logger).toHaveProperty("info");
      expect(logger).toHaveProperty("error");
      expect(logger).toHaveProperty("warn");
      expect(logger).toHaveProperty("debug");
      expect(logger).toHaveProperty("configureDurableLoggingContext");
    });

    it("should return DefaultLogger instance", () => {
      const logger = createDefaultLogger(loggingExecutionContext);
      expect(logger).toBeInstanceOf(DefaultLogger);
    });
  });

  describe("DefaultLogger class", () => {
    describe("constructor", () => {
      it("should create logger with execution context", () => {
        const logger = new DefaultLogger(loggingExecutionContext);
        expect(logger).toBeInstanceOf(DefaultLogger);
      });

      it("should create logger without execution context", () => {
        const logger = new DefaultLogger();
        expect(logger).toBeInstanceOf(DefaultLogger);
      });
    });

    describe("log method", () => {
      it("should format and output structured JSON for each log level", () => {
        const logger = createDefaultLogger(loggingExecutionContext);

        logger.log?.(DurableLogLevel.DEBUG, "debug message");
        logger.log?.(DurableLogLevel.INFO, "info message");
        logger.log?.(DurableLogLevel.WARN, "warn message");
        logger.log?.(DurableLogLevel.ERROR, "error message");

        expect(mockConsole.debug).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "DEBUG",
            executionArn: "durable-execution-arn",
            message: "debug message",
          }),
        );

        expect(mockConsole.info).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "INFO",
            executionArn: "durable-execution-arn",
            message: "info message",
          }),
        );

        expect(mockConsole.warn).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "WARN",
            executionArn: "durable-execution-arn",
            message: "warn message",
          }),
        );

        expect(mockConsole.error).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "ERROR",
            executionArn: "durable-execution-arn",
            message: "error message",
          }),
        );
      });

      it("should use configureDurableLoggingContext when provided", () => {
        const logger = createDefaultLogger();
        const mockDurableLogData: DurableLogData = {
          requestId: "mock-request-id",
          executionArn: "test-arn",
          operationId: "abc123",
          tenantId: "test-tenant",
        };

        logger.configureDurableLoggingContext?.({
          getDurableLogData: () => mockDurableLogData,
        });

        logger.log?.(DurableLogLevel.INFO, "test message");

        expect(mockConsole.info).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "mock-request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "INFO",
            executionArn: "test-arn",
            tenantId: "test-tenant",
            operationId: "abc123",
            message: "test message",
          }),
        );
      });

      it("should include attempt field when provided", () => {
        const logger = createDefaultLogger();
        const mockDurableLogData: DurableLogData = {
          requestId: "mock-request-id",
          executionArn: "test-arn",
          operationId: "retry-step",
          attempt: 2,
        };

        logger.configureDurableLoggingContext?.({
          getDurableLogData: () => mockDurableLogData,
        });

        logger.log?.(DurableLogLevel.INFO, "retry attempt message");

        expect(mockConsole.info).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "mock-request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "INFO",
            executionArn: "test-arn",
            operationId: "retry-step",
            attempt: 2,
            message: "retry attempt message",
          }),
        );
      });

      it("should omit operationId and attempt when undefined", () => {
        const logger = createDefaultLogger();
        const mockDurableLogData: DurableLogData = {
          requestId: "mock-request-id",
          executionArn: "test-arn",
          operationId: undefined,
          attempt: undefined,
        };

        logger.configureDurableLoggingContext?.({
          getDurableLogData: () => mockDurableLogData,
        });

        logger.log?.(DurableLogLevel.INFO, "test message");

        expect(mockConsole.info).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "mock-request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "INFO",
            executionArn: "test-arn",
            message: "test message",
          }),
        );
      });

      it("should handle multiple message parameters with util.format", () => {
        const logger = createDefaultLogger(loggingExecutionContext);

        logger.log?.(DurableLogLevel.INFO, "Hello %s", "world", 123);

        expect(mockConsole.info).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "INFO",
            executionArn: "durable-execution-arn",
            message: "Hello world 123",
          }),
        );
      });

      it("should handle Error objects and extract error information", () => {
        const logger = createDefaultLogger(loggingExecutionContext);
        const error = new Error("Test error");
        error.stack = "Error: Test error\n    at test.js:1:1";

        logger.log?.(DurableLogLevel.ERROR, "Error occurred:", error);

        const expectedCall = mockConsole.error.mock.calls[0][0];
        const parsedLog = JSON.parse(expectedCall);

        expect(parsedLog).toMatchObject({
          timestamp: "2025-11-21T18:33:33.938Z",
          level: "ERROR",
          requestId: "request-id",
          executionArn: "durable-execution-arn",
          message: "Error occurred: Error: Test error\n    at test.js:1:1",
          errorType: "Error",
          errorMessage: "Test error",
          stackTrace: ["Error: Test error", "    at test.js:1:1"],
        });
      });

      it("should handle single parameter that is an Error object", () => {
        const logger = createDefaultLogger(loggingExecutionContext);
        const error = new Error("Test error");
        error.stack = "Error: Test error\n    at test.js:1:1";

        logger.log?.(DurableLogLevel.ERROR, error);

        const expectedCall = mockConsole.error.mock.calls[0][0];
        const parsedLog = JSON.parse(expectedCall);

        expect(parsedLog).toMatchObject({
          timestamp: "2025-11-21T18:33:33.938Z",
          level: "ERROR",
          requestId: "request-id",
          executionArn: "durable-execution-arn",
          message: {
            errorType: "Error",
            errorMessage: "Test error",
            stackTrace: ["Error: Test error", "    at test.js:1:1"],
          },
        });
      });

      it("should default to INFO level for unknown log levels", () => {
        const logger = createDefaultLogger(loggingExecutionContext);

        logger.log?.("UNKNOWN" as DurableLogLevel, "test message");

        expect(mockConsole.info).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "INFO",
            executionArn: "durable-execution-arn",
            message: "test message",
          }),
        );
      });

      it("should handle JSON stringify errors and fall back to util.format", () => {
        const logger = createDefaultLogger(loggingExecutionContext);

        // Create an object with circular reference to trigger stringify error
        const circularObj: any = { name: "circular" };
        circularObj.self = circularObj;

        logger.log?.(DurableLogLevel.INFO, circularObj);

        // Should fall back to util.format and stringify without error replacer
        // util.format handles circular references with a detailed representation
        expect(mockConsole.info).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "INFO",
            executionArn: "durable-execution-arn",
            message: "<ref *1> { name: 'circular', self: [Circular *1] }",
          }),
        );
      });

      it("should handle Error objects with no constructor name", () => {
        const logger = createDefaultLogger(loggingExecutionContext);

        // Create error with no constructor name
        const errorWithoutConstructor = Object.create(Error.prototype);
        errorWithoutConstructor.message = "Test error";
        errorWithoutConstructor.stack = "Test error\n    at test.js:1:1";
        errorWithoutConstructor.constructor = null;

        logger.log?.(DurableLogLevel.ERROR, errorWithoutConstructor);

        const expectedCall = mockConsole.error.mock.calls[0][0];
        const parsedLog = JSON.parse(expectedCall);

        expect(parsedLog).toMatchObject({
          timestamp: "2025-11-21T18:33:33.938Z",
          level: "ERROR",
          requestId: "request-id",
          executionArn: "durable-execution-arn",
          message: {
            errorType: "UnknownError",
            errorMessage: "Test error",
            stackTrace: ["Test error", "    at test.js:1:1"],
          },
        });
      });

      it("should handle Error objects with non-string stack", () => {
        const logger = createDefaultLogger(loggingExecutionContext);

        // Create error with non-string stack
        const errorWithArrayStack = new Error("Test error");
        errorWithArrayStack.stack = [
          "Error: Test error",
          "    at test.js:1:1",
        ] as any;

        logger.log?.(DurableLogLevel.ERROR, errorWithArrayStack);

        const expectedCall = mockConsole.error.mock.calls[0][0];
        const parsedLog = JSON.parse(expectedCall);

        expect(parsedLog).toMatchObject({
          timestamp: "2025-11-21T18:33:33.938Z",
          level: "ERROR",
          requestId: "request-id",
          executionArn: "durable-execution-arn",
          message: {
            errorType: "Error",
            errorMessage: "Test error",
            stackTrace: ["Error: Test error", "    at test.js:1:1"],
          },
        });
      });

      it("should handle tenantId as null", () => {
        const logger = createDefaultLogger();
        const mockDurableLogData: DurableLogData = {
          requestId: "mock-request-id",
          executionArn: "test-arn",
          operationId: "abc123",
          tenantId: null as any,
        };

        logger.configureDurableLoggingContext?.({
          getDurableLogData: () => mockDurableLogData,
        });

        logger.log?.(DurableLogLevel.INFO, "test message");

        expect(mockConsole.info).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "mock-request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "INFO",
            executionArn: "test-arn",
            operationId: "abc123",
            message: "test message",
          }),
        );
      });

      it("should handle Error with no constructor in multi-param case", () => {
        const logger = createDefaultLogger(loggingExecutionContext);

        // Create error with no constructor name
        const errorWithoutConstructor = Object.create(Error.prototype);
        errorWithoutConstructor.message = "Test error";
        errorWithoutConstructor.stack = "Test error\n    at test.js:1:1";
        errorWithoutConstructor.constructor = null;

        logger.log?.(
          DurableLogLevel.ERROR,
          "Error occurred:",
          errorWithoutConstructor,
        );

        const expectedCall = mockConsole.error.mock.calls[0][0];
        const parsedLog = JSON.parse(expectedCall);

        expect(parsedLog).toMatchObject({
          timestamp: "2025-11-21T18:33:33.938Z",
          level: "ERROR",
          requestId: "request-id",
          executionArn: "durable-execution-arn",
          message:
            "Error occurred: Error {\n  message: 'Test error',\n  stack: 'Test error\\n    at test.js:1:1',\n  constructor: null\n}",
          errorType: "UnknownError",
          errorMessage: "Test error",
          stackTrace: ["Test error", "    at test.js:1:1"],
        });
      });

      it("should handle Error with non-string stack in multi-param case", () => {
        const logger = createDefaultLogger(loggingExecutionContext);

        // Create error with non-string stack
        const errorWithArrayStack = new Error("Test error");
        errorWithArrayStack.stack = undefined as any;

        logger.log?.(
          DurableLogLevel.ERROR,
          "Error occurred:",
          errorWithArrayStack,
        );

        const expectedCall = mockConsole.error.mock.calls[0][0];
        const parsedLog = JSON.parse(expectedCall);

        expect(parsedLog).toMatchObject({
          timestamp: "2025-11-21T18:33:33.938Z",
          level: "ERROR",
          requestId: "request-id",
          executionArn: "durable-execution-arn",
          message: "Error occurred: [Error: Test error]",
          errorType: "Error",
          errorMessage: "Test error",
          stackTrace: [],
        });
      });

      it("should throw error when no logging context is configured", () => {
        const logger = new DefaultLogger();

        expect(() => {
          logger.log?.(DurableLogLevel.INFO, "test message");
        }).toThrow(
          "DurableLoggingContext is not configured. Please call configureDurableLoggingContext before logging.",
        );
      });
    });

    describe("log level filtering", () => {
      it("should enable all methods when AWS_LAMBDA_LOG_LEVEL is DEBUG", () => {
        process.env["AWS_LAMBDA_LOG_LEVEL"] = "DEBUG";
        const logger = createDefaultLogger(loggingExecutionContext);

        logger.debug("debug message");
        logger.info("info message");
        logger.warn("warn message");
        logger.error("error message");

        expect(mockConsole.debug).toHaveBeenCalled();
        expect(mockConsole.info).toHaveBeenCalled();
        expect(mockConsole.warn).toHaveBeenCalled();
        expect(mockConsole.error).toHaveBeenCalled();
      });

      it("should disable debug when AWS_LAMBDA_LOG_LEVEL is INFO", () => {
        process.env["AWS_LAMBDA_LOG_LEVEL"] = "INFO";
        const logger = createDefaultLogger(loggingExecutionContext);

        logger.debug("debug message");
        logger.info("info message");
        logger.warn("warn message");
        logger.error("error message");

        expect(mockConsole.debug).not.toHaveBeenCalled();
        expect(mockConsole.info).toHaveBeenCalled();
        expect(mockConsole.warn).toHaveBeenCalled();
        expect(mockConsole.error).toHaveBeenCalled();
      });

      it("should disable debug and info when AWS_LAMBDA_LOG_LEVEL is WARN", () => {
        process.env["AWS_LAMBDA_LOG_LEVEL"] = "WARN";
        const logger = createDefaultLogger(loggingExecutionContext);

        logger.debug("debug message");
        logger.info("info message");
        logger.warn("warn message");
        logger.error("error message");

        expect(mockConsole.debug).not.toHaveBeenCalled();
        expect(mockConsole.info).not.toHaveBeenCalled();
        expect(mockConsole.warn).toHaveBeenCalled();
        expect(mockConsole.error).toHaveBeenCalled();
      });

      it("should only enable error when AWS_LAMBDA_LOG_LEVEL is ERROR", () => {
        process.env["AWS_LAMBDA_LOG_LEVEL"] = "ERROR";
        const logger = createDefaultLogger(loggingExecutionContext);

        logger.debug("debug message");
        logger.info("info message");
        logger.warn("warn message");
        logger.error("error message");

        expect(mockConsole.debug).not.toHaveBeenCalled();
        expect(mockConsole.info).not.toHaveBeenCalled();
        expect(mockConsole.warn).not.toHaveBeenCalled();
        expect(mockConsole.error).toHaveBeenCalled();
      });

      it("should default to DEBUG level when AWS_LAMBDA_LOG_LEVEL is invalid", () => {
        process.env["AWS_LAMBDA_LOG_LEVEL"] = "INVALID";
        const logger = createDefaultLogger(loggingExecutionContext);

        logger.debug("debug message");

        expect(mockConsole.debug).toHaveBeenCalled();
      });

      it("should default to DEBUG level when AWS_LAMBDA_LOG_LEVEL is not set", () => {
        delete process.env["AWS_LAMBDA_LOG_LEVEL"];
        const logger = createDefaultLogger(loggingExecutionContext);

        logger.debug("debug message");

        expect(mockConsole.debug).toHaveBeenCalled();
      });
    });

    describe("individual logging methods output format", () => {
      it("should format output correctly for each individual method", () => {
        const logger = createDefaultLogger(loggingExecutionContext);

        logger.info("info message");
        logger.error("error message");
        logger.warn("warn message");
        logger.debug("debug message");

        expect(mockConsole.info).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "INFO",
            executionArn: "durable-execution-arn",
            message: "info message",
          }),
        );

        expect(mockConsole.error).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "ERROR",
            executionArn: "durable-execution-arn",
            message: "error message",
          }),
        );

        expect(mockConsole.warn).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "WARN",
            executionArn: "durable-execution-arn",
            message: "warn message",
          }),
        );

        expect(mockConsole.debug).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "DEBUG",
            executionArn: "durable-execution-arn",
            message: "debug message",
          }),
        );
      });

      it("should handle optional message parameter", () => {
        const logger = createDefaultLogger(loggingExecutionContext);

        logger.info(); // No message
        logger.info("with message");

        expect(mockConsole.info).toHaveBeenCalledTimes(2);

        // First call with no message - util.format() with no args returns empty string
        const firstCall = JSON.parse(mockConsole.info.mock.calls[0][0]);
        expect(firstCall.message).toBe("");

        // Second call with message
        const secondCall = JSON.parse(mockConsole.info.mock.calls[1][0]);
        expect(secondCall.message).toBe("with message");
      });
    });

    describe("configureDurableLoggingContext?. method", () => {
      it("should configure logging context correctly", () => {
        const logger = new DefaultLogger();
        const mockDurableLogData: DurableLogData = {
          requestId: "custom-request-id",
          executionArn: "custom-arn",
          operationId: "custom-operation",
        };

        const mockContext = {
          shouldLog: jest.fn().mockReturnValue(true),
          getDurableLogData: jest.fn().mockReturnValue(mockDurableLogData),
        };

        logger.configureDurableLoggingContext?.(mockContext);
        logger.info("test message");

        expect(mockContext.getDurableLogData).toHaveBeenCalled();
        expect(mockConsole.info).toHaveBeenCalledWith(
          JSON.stringify({
            requestId: "custom-request-id",
            timestamp: "2025-11-21T18:33:33.938Z",
            level: "INFO",
            executionArn: "custom-arn",
            operationId: "custom-operation",
            message: "test message",
          }),
        );
      });
    });
  });
});
