import { createDefaultLogger } from "./default-logger";

describe("Default Logger", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should create a logger with all required methods", () => {
    const logger = createDefaultLogger();

    expect(logger).toHaveProperty("log");
    expect(logger).toHaveProperty("info");
    expect(logger).toHaveProperty("error");
    expect(logger).toHaveProperty("warn");
    expect(logger).toHaveProperty("debug");
  });

  it("should log with custom level and all parameters", () => {
    const logger = createDefaultLogger();
    const testData = { key: "value" };
    const testError = new Error("test error");

    logger.log?.("custom", "test message", testData, testError);

    expect(consoleSpy).toHaveBeenCalledWith(
      "custom",
      "test message",
      testData,
      testError,
    );
  });

  it("should log info messages", () => {
    const logger = createDefaultLogger();
    const testData = { info: "data" };

    logger.info("info message", testData);

    expect(consoleSpy).toHaveBeenCalledWith("info", "info message", testData);
  });

  it("should log error messages", () => {
    const logger = createDefaultLogger();
    const testError = new Error("test error");
    const testData = { error: "data" };

    logger.error("error message", testError, testData);

    expect(consoleSpy).toHaveBeenCalledWith(
      "error",
      "error message",
      testError,
      testData,
    );
  });

  it("should log warn messages", () => {
    const logger = createDefaultLogger();
    const testData = { warn: "data" };

    logger.warn("warn message", testData);

    expect(consoleSpy).toHaveBeenCalledWith("warn", "warn message", testData);
  });

  it("should log debug messages", () => {
    const logger = createDefaultLogger();
    const testData = { debug: "data" };

    logger.debug("debug message", testData);

    expect(consoleSpy).toHaveBeenCalledWith("debug", "debug message", testData);
  });
});
