import { createDefaultLogger } from "./default-logger";

describe("Default Logger", () => {
  let consoleSpies: {
    log: jest.SpyInstance;
    info: jest.SpyInstance;
    error: jest.SpyInstance;
    warn: jest.SpyInstance;
    debug: jest.SpyInstance;
  };

  beforeEach(() => {
    consoleSpies = {
      log: jest.spyOn(console, "log").mockImplementation(),
      info: jest.spyOn(console, "info").mockImplementation(),
      error: jest.spyOn(console, "error").mockImplementation(),
      warn: jest.spyOn(console, "warn").mockImplementation(),
      debug: jest.spyOn(console, "debug").mockImplementation(),
    };
  });

  afterEach(() => {
    Object.values(consoleSpies).forEach(spy => spy.mockRestore());
  });

  it("should create a logger with all required methods", () => {
    const logger = createDefaultLogger();

    expect(logger).toHaveProperty("log");
    expect(logger).toHaveProperty("info");
    expect(logger).toHaveProperty("error");
    expect(logger).toHaveProperty("warn");
    expect(logger).toHaveProperty("debug");
  });

  it("should output structured data using appropriate console methods", () => {
    const logger = createDefaultLogger();
    const structuredData = {
      timestamp: "2025-11-21T18:33:33.938Z",
      execution_arn: "test-arn",
      level: "info",
      step_id: "abc123",
      message: "structured message",
    };

    logger.info("structured message", structuredData);

    expect(consoleSpies.info).toHaveBeenCalledWith(structuredData);
  });

  it("should use correct console methods for each log level", () => {
    const logger = createDefaultLogger();
    const testData = { test: "data" };

    logger.log?.("custom", "test message", testData);
    logger.info("info message", testData);
    logger.error("error message", new Error("test"), testData);
    logger.warn("warn message", testData);
    logger.debug("debug message", testData);

    expect(consoleSpies.log).toHaveBeenCalledWith(testData);
    expect(consoleSpies.info).toHaveBeenCalledWith(testData);
    expect(consoleSpies.error).toHaveBeenCalledWith(testData);
    expect(consoleSpies.warn).toHaveBeenCalledWith(testData);
    expect(consoleSpies.debug).toHaveBeenCalledWith(testData);
  });
});
