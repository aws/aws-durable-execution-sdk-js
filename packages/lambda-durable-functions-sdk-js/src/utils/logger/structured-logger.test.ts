import { createStructuredLogger, setCustomLogger } from "./structured-logger";
import { hashId } from "../step-id-utils/step-id-utils";

describe("StructuredLogger", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    setCustomLogger(null); // Reset custom logger before each test
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    setCustomLogger(null); // Clean up after each test
  });

  it("should log with basic context", () => {
    const logger = createStructuredLogger({
      executionId: "test-execution-123",
    });

    logger.info("Test message", { key: "value" });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);

    expect(loggedData).toMatchObject({
      level: "info",
      message: "Test message",
      execution_id: "test-execution-123",
      data: { key: "value" },
    });
    expect(loggedData.timestamp).toBeDefined();
    expect(loggedData.stepId).toBeUndefined();
    expect(loggedData.attempt).toBeUndefined();
  });

  it("should log with stepId and attempt", () => {
    const logger = createStructuredLogger({
      executionId: "test-execution-123",
      stepId: "step-1",
      attempt: 2,
    });

    logger.error("Error occurred", new Error("Test error"));

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);

    expect(loggedData).toMatchObject({
      level: "error",
      message: "Error occurred",
      execution_id: "test-execution-123",
      step_id: hashId("step-1"),
      attempt: 2,
    });
    expect(loggedData.error).toMatchObject({
      name: "Error",
      message: "Test error",
    });
    expect(loggedData.error.stack).toBeDefined();
    expect(loggedData.timestamp).toBeDefined();
  });

  it("should omit undefined fields", () => {
    const logger = createStructuredLogger({
      executionId: "test-execution-123",
      stepId: undefined,
      attempt: undefined,
    });

    logger.warn("Warning message");

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);

    expect(loggedData).toMatchObject({
      level: "warn",
      message: "Warning message",
      execution_id: "test-execution-123",
    });
    expect(loggedData.timestamp).toBeDefined();
    expect(loggedData).not.toHaveProperty("stepId");
    expect(loggedData).not.toHaveProperty("attempt");
    expect(loggedData).not.toHaveProperty("data");
  });

  it("should handle all log levels", () => {
    const logger = createStructuredLogger({
      executionId: "test-execution-123",
    });

    logger.debug("Debug message");
    logger.info("Info message");
    logger.warn("Warn message");
    logger.error("Error message");
    logger.log("Log message");

    expect(consoleSpy).toHaveBeenCalledTimes(5);

    const logs = consoleSpy.mock.calls.map((call) => JSON.parse(call[0]));
    expect(logs[0].level).toBe("debug");
    expect(logs[1].level).toBe("info");
    expect(logs[2].level).toBe("warn");
    expect(logs[3].level).toBe("error");
    expect(logs[4].level).toBe("info"); // log() maps to info level
  });

  it("should log with only data (no message)", () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();
    const logger = createStructuredLogger({
      executionId: "test-execution",
      stepId: "test-step",
      attempt: 1,
    });

    logger.info(undefined, { key: "value", count: 42 });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);

    expect(loggedData).toEqual({
      timestamp: expect.any(String),
      level: "info",
      execution_id: "test-execution",
      step_id: hashId("test-step"),
      attempt: 1,
      data: { key: "value", count: 42 },
    });

    // Verify that message field is not present
    expect(loggedData).not.toHaveProperty("message");

    consoleSpy.mockRestore();
  });

  it("should use custom logger when set for all methods", () => {
    const mockCustomLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    };

    setCustomLogger(mockCustomLogger);

    const logger = createStructuredLogger({
      executionId: "test-execution",
      stepId: "test-step",
      attempt: 1,
    });

    // Test log method (maps to info)
    logger.log("Test log message", { data: "test" });
    expect(mockCustomLogger.info).toHaveBeenCalledWith("Test log message", {
      data: "test",
    });

    // Test error method
    const testError = new Error("Test error");
    logger.error("Error message", testError, { context: "test" });
    expect(mockCustomLogger.error).toHaveBeenCalledWith(
      "Error message",
      testError,
      { context: "test" },
    );

    // Test warn method
    logger.warn("Warning message", { warning: true });
    expect(mockCustomLogger.warn).toHaveBeenCalledWith("Warning message", {
      warning: true,
    });

    // Test info method
    logger.info("Info message", { info: true });
    expect(mockCustomLogger.info).toHaveBeenCalledWith("Info message", {
      info: true,
    });

    // Test debug method
    logger.debug("Debug message", { debug: true });
    expect(mockCustomLogger.debug).toHaveBeenCalledWith("Debug message", {
      debug: true,
    });

    // Ensure console.log was not called
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("should use custom logger for logWithContext internal calls", () => {
    const mockCustomLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    };

    setCustomLogger(mockCustomLogger);

    const logger = createStructuredLogger({
      executionId: "test-execution",
      stepId: "test-step",
      attempt: 1,
    });

    // This will trigger the logWithContext function with custom logger
    logger.error("Error message", new Error("Test error"), { context: "test" });

    // Verify the custom logger's log method was called through logWithContext
    expect(mockCustomLogger.error).toHaveBeenCalledWith(
      "Error message",
      expect.any(Error),
      { context: "test" },
    );

    // Ensure console.log was not called (testing the return path)
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
