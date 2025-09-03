import { createStructuredLogger, setCustomLogger } from "./structured-logger";
import { Logger } from "../../types";

describe("Custom Logger Integration", () => {
  let mockCustomLogger: jest.Mocked<Logger>;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    mockCustomLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    };
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    setCustomLogger(null); // Reset custom logger
  });

  it("should use default JSON logging when no custom logger is set", () => {
    const logger = createStructuredLogger({
      executionId: "test-execution",
      stepId: "test-step",
      attempt: 1,
    });

    logger.info("Test message", { key: "value" });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"level":"info"'),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"message":"Test message"'),
    );
  });

  it("should use custom logger when configured", () => {
    setCustomLogger(mockCustomLogger);

    const logger = createStructuredLogger({
      executionId: "test-execution",
      stepId: "test-step",
      attempt: 1,
    });

    logger.info("Test message", { key: "value" });

    expect(mockCustomLogger.info).toHaveBeenCalledWith("Test message", {
      key: "value",
    });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("should use custom logger for error logging", () => {
    setCustomLogger(mockCustomLogger);

    const logger = createStructuredLogger({
      executionId: "test-execution",
      stepId: "test-step",
      attempt: 1,
    });

    const testError = new Error("Test error");
    logger.error("Error occurred", testError, { context: "test" });

    expect(mockCustomLogger.error).toHaveBeenCalledWith(
      "Error occurred",
      testError,
      { context: "test" },
    );
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("should use custom logger for all log levels", () => {
    setCustomLogger(mockCustomLogger);

    const logger = createStructuredLogger({
      executionId: "test-execution",
      stepId: "test-step",
      attempt: 1,
    });

    logger.debug("Debug message", { debug: true });
    logger.info("Info message", { info: true });
    logger.warn("Warn message", { warn: true });
    logger.error("Error message", new Error("test"), { error: true });

    expect(mockCustomLogger.debug).toHaveBeenCalledWith("Debug message", {
      debug: true,
    });
    expect(mockCustomLogger.info).toHaveBeenCalledWith("Info message", {
      info: true,
    });
    expect(mockCustomLogger.warn).toHaveBeenCalledWith("Warn message", {
      warn: true,
    });
    expect(mockCustomLogger.error).toHaveBeenCalledWith(
      "Error message",
      new Error("test"),
      { error: true },
    );
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("should revert to default logging when custom logger is removed", () => {
    setCustomLogger(mockCustomLogger);
    setCustomLogger(null); // Remove custom logger

    const logger = createStructuredLogger({
      executionId: "test-execution",
      stepId: "test-step",
      attempt: 1,
    });

    logger.info("Test message");

    expect(mockCustomLogger.info).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"level":"info"'),
    );
  });
});
