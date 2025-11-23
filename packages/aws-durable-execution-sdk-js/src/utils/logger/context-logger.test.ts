import { createContextLoggerFactory } from "./context-logger";
import {
  DurableLogData,
  EnrichedDurableLogger,
  ExecutionContext,
  DurableLogLevel,
} from "../../types";
import { hashId } from "../step-id-utils/step-id-utils";

describe("Context Logger", () => {
  let mockBaseLogger: EnrichedDurableLogger;
  let mockGetLogger: () => EnrichedDurableLogger;
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
      requestId: "mock-request-id",
      tenantId: "test-tenant-id",
    } as ExecutionContext;

    // Mock Date.prototype.toISOString for consistent timestamps
    jest
      .spyOn(Date.prototype, "toISOString")
      .mockReturnValue("2025-11-21T18:33:33.938Z");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("should create context logger with enriched data", () => {
    const factory = createContextLoggerFactory(
      mockExecutionContext,
      mockGetLogger,
    );
    const logger = factory("test-step", 1);

    logger.info("test message", { key: "value" });

    expect(mockBaseLogger.info).toHaveBeenCalledWith(
      {
        executionArn: "test-execution-arn",
        requestId: "mock-request-id",
        tenantId: "test-tenant-id",
        operationId: hashId("test-step"),
        attempt: 1,
      },
      "test message",
      { key: "value" },
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
      {
        executionArn: "test-execution-arn",
        requestId: "mock-request-id",
        tenantId: "test-tenant-id",
        operationId: hashId("test-step"),
        attempt: undefined,
      },
      "warning",
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
      {
        executionArn: "test-execution-arn",
        requestId: "mock-request-id",
        tenantId: "test-tenant-id",
        operationId: hashId("test-step"),
        attempt: undefined,
      },
      "error message",
      testError,
      { extra: "data" },
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
      {
        executionArn: "test-execution-arn",
        requestId: "mock-request-id",
        tenantId: "test-tenant-id",
        operationId: hashId("debug-step"),
        attempt: undefined,
      },
      "debug info",
    );
  });

  test("should handle generic log method", () => {
    const factory = createContextLoggerFactory(
      mockExecutionContext,
      mockGetLogger,
    );
    const logger = factory("generic-step");
    const testError = new Error("generic error");

    logger.log?.(
      "custom" as any,
      "custom message",
      { custom: "data" },
      testError,
    );

    expect(mockBaseLogger.log).toHaveBeenCalledWith(
      "custom",
      {
        executionArn: "test-execution-arn",
        requestId: "mock-request-id",
        tenantId: "test-tenant-id",
        operationId: hashId("generic-step"),
        attempt: undefined,
      },
      "custom message",
      { custom: "data" },
      testError,
    );
  });

  test("should work with default logger fallback", () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    // Create a default logger that mimics the one in durable-context
    const createDefaultLogger = (): EnrichedDurableLogger => ({
      log: (
        level: string,
        durableLogData: DurableLogData,
        ...optionalParams: unknown[]
      ) =>
        // eslint-disable-next-line no-console
        console.log(level, durableLogData, ...optionalParams),
      info: (durableLogData: DurableLogData, ...optionalParams: unknown[]) =>
        // eslint-disable-next-line no-console
        console.log("info", durableLogData, ...optionalParams),
      error: (durableLogData: DurableLogData, ...optionalParams: unknown[]) =>
        // eslint-disable-next-line no-console
        console.log("error", durableLogData, ...optionalParams),
      warn: (durableLogData: DurableLogData, ...optionalParams: unknown[]) =>
        // eslint-disable-next-line no-console
        console.log("warn", durableLogData, ...optionalParams),
      debug: (durableLogData: DurableLogData, ...optionalParams: unknown[]) =>
        // eslint-disable-next-line no-console
        console.log("debug", durableLogData, ...optionalParams),
    });

    const defaultLogger = createDefaultLogger();
    const getDefaultLogger = (): EnrichedDurableLogger => defaultLogger;

    const factory = createContextLoggerFactory(
      mockExecutionContext,
      getDefaultLogger,
    );
    const logger = factory("test-step");

    // Test all logger methods to ensure coverage
    logger.log?.(
      "custom" as any,
      "log message",
      { data: "test" },
      new Error("test error"),
    );
    logger.info("info message", { info: "data" });
    logger.error("error message", new Error("test error"), { error: "data" });
    logger.warn("warn message", { warn: "data" });
    logger.debug("debug message", { debug: "data" });

    // Verify console.log was called with DurableLogData as first param
    expect(consoleSpy).toHaveBeenCalledWith(
      "custom",
      {
        executionArn: "test-execution-arn",
        requestId: "mock-request-id",
        tenantId: "test-tenant-id",
        operationId: hashId("test-step"),
      },
      "log message",
      { data: "test" },
      expect.any(Error),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "info",
      {
        executionArn: "test-execution-arn",
        requestId: "mock-request-id",
        tenantId: "test-tenant-id",
        operationId: hashId("test-step"),
      },
      "info message",
      {
        info: "data",
      },
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "error",
      {
        executionArn: "test-execution-arn",
        requestId: "mock-request-id",
        tenantId: "test-tenant-id",
        operationId: hashId("test-step"),
      },
      "error message",
      expect.any(Error),
      { error: "data" },
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "warn",
      {
        executionArn: "test-execution-arn",
        requestId: "mock-request-id",
        tenantId: "test-tenant-id",
        operationId: hashId("test-step"),
      },
      "warn message",
      {
        warn: "data",
      },
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "debug",
      {
        executionArn: "test-execution-arn",
        requestId: "mock-request-id",
        tenantId: "test-tenant-id",
        operationId: hashId("test-step"),
      },
      "debug message",
      {
        debug: "data",
      },
    );

    consoleSpy.mockRestore();
  });

  test("should handle context without operationId", () => {
    const factory = createContextLoggerFactory(
      mockExecutionContext,
      mockGetLogger,
    );
    const logger = factory(); // No operationId provided

    logger.info("test message");

    expect(mockBaseLogger.info).toHaveBeenCalledWith(
      {
        executionArn: "test-execution-arn",
        requestId: "mock-request-id",
        tenantId: "test-tenant-id",
        operationId: undefined,
        attempt: undefined,
      },
      "test message",
    );
  });

  test("should handle context without tenantId", () => {
    const contextWithoutTenant = {
      ...mockExecutionContext,
      tenantId: undefined,
    };

    const factory = createContextLoggerFactory(
      contextWithoutTenant,
      mockGetLogger,
    );
    const logger = factory("test-step");

    logger.info("test message");

    expect(mockBaseLogger.info).toHaveBeenCalledWith(
      {
        executionArn: "test-execution-arn",
        requestId: "mock-request-id",
        tenantId: undefined,
        operationId: hashId("test-step"),
        attempt: undefined,
      },
      "test message",
    );
  });

  test("should handle baseLogger.log being undefined", () => {
    const loggerWithoutLogMethod = {
      ...mockBaseLogger,
      log: undefined,
    };
    const getLoggerWithoutLog = (): EnrichedDurableLogger =>
      loggerWithoutLogMethod;

    const factory = createContextLoggerFactory(
      mockExecutionContext,
      getLoggerWithoutLog,
    );
    const logger = factory("test-step");

    // The log method should not be undefined
    expect(logger.log).not.toBeUndefined();

    // Logger.log should still work with default behaviour
    logger.log("INFO", "test message");
    logger.log("WARN", "test message");
    logger.log("ERROR", "test message");
    logger.log("DEBUG", "test message");
    logger.log("custom" as any, "test message");
    expect(mockBaseLogger.info).toHaveBeenCalledTimes(2);
    expect(mockBaseLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockBaseLogger.error).toHaveBeenCalledTimes(1);
    expect(mockBaseLogger.debug).toHaveBeenCalledTimes(1);
  });

  test("should capture baseLogger.log reference at creation time to prevent race conditions", () => {
    const originalLogFn = jest.fn();
    const dynamicLogger: EnrichedDurableLogger = {
      log: originalLogFn,
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const getDynamicLogger = (): EnrichedDurableLogger => dynamicLogger;

    const factory = createContextLoggerFactory(
      mockExecutionContext,
      getDynamicLogger,
    );
    const logger = factory("test-step");

    // Verify the log method was captured and is available
    expect(logger.log).toBeDefined();

    // Now modify the dynamic logger's log method to undefined
    // This simulates a scenario where the base logger changes after context logger creation
    dynamicLogger.log = undefined;

    // The context logger should still work because it captured the original reference
    logger.log("INFO", "test message");

    // Verify the original log method was called, not the undefined one
    expect(originalLogFn).toHaveBeenCalledWith(
      "INFO",
      {
        executionArn: "test-execution-arn",
        requestId: "mock-request-id",
        tenantId: "test-tenant-id",
        operationId: hashId("test-step"),
        attempt: undefined,
      },
      "test message",
    );
  });
});
