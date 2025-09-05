import { createContextLoggerFactory } from "./context-logger";
import { Logger, ExecutionContext } from "../../types";

describe("Context Logger", () => {
  let mockBaseLogger: Logger;
  let mockGetLogger: () => Logger;
  let mockExecutionContext: ExecutionContext;

  beforeEach(() => {
    mockBaseLogger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
    mockGetLogger = jest.fn().mockReturnValue(mockBaseLogger);
    mockExecutionContext = {
      durableExecutionArn: "test-execution-arn",
    } as ExecutionContext;
  });

  test("should create context logger with enriched data", () => {
    const factory = createContextLoggerFactory(
      mockExecutionContext,
      mockGetLogger,
    );
    const logger = factory("test-step", 1);

    logger.info("test message", { key: "value" });

    expect(mockBaseLogger.info).toHaveBeenCalledWith(
      "test message",
      expect.objectContaining({
        execution_arn: "test-execution-arn",
        step_id: "test-step",
        attempt: 1,
        level: "info",
        message: "test message",
        data: { key: "value" },
        timestamp: expect.any(String),
      }),
    );
  });

  test("should create context logger without attempt", () => {
    const factory = createContextLoggerFactory(
      mockExecutionContext,
      mockGetLogger,
    );
    const logger = factory("test-step");

    logger.warn("warning");

    expect(mockBaseLogger.warn).toHaveBeenCalledWith(
      "warning",
      expect.objectContaining({
        execution_arn: "test-execution-arn",
        step_id: "test-step",
        level: "warn",
        message: "warning",
      }),
    );
    expect(mockBaseLogger.warn).toHaveBeenCalledWith(
      "warning",
      expect.not.objectContaining({
        attempt: expect.anything(),
      }),
    );
  });

  test("should handle error logging with error object", () => {
    const factory = createContextLoggerFactory(
      mockExecutionContext,
      mockGetLogger,
    );
    const logger = factory("test-step");
    const testError = new Error("test error");

    logger.error("error message", testError, { extra: "data" });

    expect(mockBaseLogger.error).toHaveBeenCalledWith(
      "error message",
      testError,
      expect.objectContaining({
        level: "error",
        message: "error message",
        data: { extra: "data" },
        error: {
          name: "Error",
          message: "test error",
          stack: expect.any(String),
        },
      }),
    );
  });

  test("should handle debug logging", () => {
    const factory = createContextLoggerFactory(
      mockExecutionContext,
      mockGetLogger,
    );
    const logger = factory("debug-step");

    logger.debug("debug info");

    expect(mockBaseLogger.debug).toHaveBeenCalledWith(
      "debug info",
      expect.objectContaining({
        level: "debug",
        message: "debug info",
      }),
    );
  });

  test("should handle generic log method", () => {
    const factory = createContextLoggerFactory(
      mockExecutionContext,
      mockGetLogger,
    );
    const logger = factory("generic-step");
    const testError = new Error("generic error");

    logger.log("custom", "custom message", { custom: "data" }, testError);

    expect(mockBaseLogger.log).toHaveBeenCalledWith(
      "custom",
      "custom message",
      expect.objectContaining({
        level: "custom",
        message: "custom message",
        data: { custom: "data" },
        error: {
          name: "Error",
          message: "generic error",
          stack: expect.any(String),
        },
      }),
      testError,
    );
  });

  test("should work with default logger fallback", () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    // Create a default logger that mimics the one in durable-context
    const createDefaultLogger = (): Logger => ({
      log: (level: string, message?: string, data?: any, error?: Error) =>
        console.log(level, message, data, error),
      info: (message?: string, data?: any) =>
        console.log("info", message, data),
      error: (message?: string, error?: Error, data?: any) =>
        console.log("error", message, error, data),
      warn: (message?: string, data?: any) =>
        console.log("warn", message, data),
      debug: (message?: string, data?: any) =>
        console.log("debug", message, data),
    });

    const defaultLogger = createDefaultLogger();
    const getDefaultLogger = () => defaultLogger;

    const factory = createContextLoggerFactory(
      mockExecutionContext,
      getDefaultLogger,
    );
    const logger = factory("test-step");

    // Test all logger methods to ensure coverage
    logger.log(
      "custom",
      "log message",
      { data: "test" },
      new Error("test error"),
    );
    logger.info("info message", { info: "data" });
    logger.error("error message", new Error("test error"), { error: "data" });
    logger.warn("warn message", { warn: "data" });
    logger.debug("debug message", { debug: "data" });

    // Verify console.log was called (default logger was used)
    expect(consoleSpy).toHaveBeenCalledWith(
      "custom",
      "log message",
      expect.any(Object),
      expect.any(Error),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "info",
      "info message",
      expect.any(Object),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "error",
      "error message",
      expect.any(Error),
      expect.any(Object),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "warn",
      "warn message",
      expect.any(Object),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "debug",
      "debug message",
      expect.any(Object),
    );

    consoleSpy.mockRestore();
  });
});
