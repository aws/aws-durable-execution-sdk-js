import {
  Logger,
  LogLevel,
  LoggerConfig,
  defaultLogger,
  getLogLevel,
} from "../logger";

describe("Logger", () => {
  // Setup console mocks before each test
  beforeEach(() => {
    jest.spyOn(console, "debug").mockImplementation(jest.fn());
    jest.spyOn(console, "info").mockImplementation(jest.fn());
    jest.spyOn(console, "warn").mockImplementation(jest.fn());
    jest.spyOn(console, "error").mockImplementation(jest.fn());

    // Mock Date.toISOString to return consistent values for testing
    jest
      .spyOn(Date.prototype, "toISOString")
      .mockReturnValue("2025-06-30T20:04:00.000Z");
  });

  // Restore original console methods after each test
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create logger with default settings", () => {
      const logger = new Logger();

      // Instead of checking private properties directly, we'll test the behavior
      logger.info("Test message");

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining("[INFO]"),
      );
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining("[2025-06-30T20:04:00.000Z]"),
      );

      // Debug shouldn't be logged at default INFO level
      logger.debug("Debug message");
      expect(console.debug).not.toHaveBeenCalled();
    });

    it("should create logger with custom settings", () => {
      const config: LoggerConfig = {
        level: LogLevel.DEBUG,
        timestamp: false,
        showLevel: false,
        prefix: "TestPrefix",
      };

      const logger = new Logger(config);

      // Test debug level works
      logger.debug("Debug message");
      expect(console.debug).toHaveBeenCalledWith("[TestPrefix] Debug message");

      // Test timestamp is off
      logger.info("Info message");
      expect(console.info).toHaveBeenCalledWith(
        expect.not.stringContaining("[2025-"),
      );

      // Test level is not shown
      expect(console.debug).toHaveBeenCalledWith(
        expect.not.stringContaining("[DEBUG]"),
      );

      // Test prefix is shown
      logger.info("Info with prefix");
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining("[TestPrefix]"),
      );
    });

    it("should create logger with partial custom settings", () => {
      const logger = new Logger({ level: LogLevel.ERROR });

      // Info should not be logged at ERROR level
      logger.info("Info message");
      expect(console.info).not.toHaveBeenCalled();

      // Error should be logged
      logger.error("Error message");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("[ERROR]"),
      );

      // Should include timestamp by default
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("[2025-06-30T20:04:00.000Z]"),
      );
    });
  });

  describe("configure", () => {
    it("should update all settings when provided", () => {
      const logger = new Logger();

      // Initially should log at INFO level with timestamp
      logger.debug("Initial debug");
      expect(console.debug).not.toHaveBeenCalled();

      logger.info("Initial info");
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining("[2025-06-30T20:04:00.000Z] [INFO]"),
      );

      jest.mocked(console.info).mockClear();

      // Update configuration
      logger.configure({
        level: LogLevel.ERROR,
        timestamp: false,
        showLevel: false,
        prefix: "NewPrefix",
      });

      // Now info should not log
      logger.info("Info after config");
      expect(console.info).not.toHaveBeenCalled();

      // Error should log without timestamp or level
      logger.error("Error after config");
      expect(console.error).toHaveBeenCalledWith(
        "[NewPrefix] Error after config",
      );
    });

    it("should update only specified settings", () => {
      const logger = new Logger({
        level: LogLevel.INFO,
        timestamp: true,
        showLevel: true,
        prefix: "Original",
      });

      logger.configure({
        level: LogLevel.ERROR,
      });

      // Info should not log after reconfiguring to ERROR level
      logger.info("This should not log");
      expect(console.info).not.toHaveBeenCalled();

      // Error should log with original format settings
      logger.error("Error message");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "[2025-06-30T20:04:00.000Z] [ERROR] [Original]",
        ),
      );
    });
  });

  describe("logging methods", () => {
    it("should log debug messages", () => {
      const logger = new Logger({ level: LogLevel.DEBUG });

      logger.debug("Debug message", { data: "test" });

      expect(console.debug).toHaveBeenCalledWith(
        "[2025-06-30T20:04:00.000Z] [DEBUG] Debug message",
        { data: "test" },
      );
    });

    it("should log info messages", () => {
      const logger = new Logger();

      logger.info("Info message", { data: "test" });

      expect(console.info).toHaveBeenCalledWith(
        "[2025-06-30T20:04:00.000Z] [INFO] Info message",
        { data: "test" },
      );
    });

    it("should log warn messages", () => {
      const logger = new Logger();

      logger.warn("Warning message", { data: "test" });

      expect(console.warn).toHaveBeenCalledWith(
        "[2025-06-30T20:04:00.000Z] [WARN] Warning message",
        { data: "test" },
      );
    });

    it("should log error messages", () => {
      const logger = new Logger();

      logger.error("Error message", new Error("test error"));

      expect(console.error).toHaveBeenCalledWith(
        "[2025-06-30T20:04:00.000Z] [ERROR] Error message",
        new Error("test error"),
      );
    });

    it("should log multiple optional params", () => {
      const logger = new Logger();

      logger.info("Message", "param1", "param2", { key: "value" });

      expect(console.info).toHaveBeenCalledWith(
        "[2025-06-30T20:04:00.000Z] [INFO] Message",
        "param1",
        "param2",
        { key: "value" },
      );
    });
  });

  describe("log level filtering", () => {
    it("should not log messages below configured level", () => {
      const logger = new Logger({ level: LogLevel.WARN });

      logger.debug("Debug message");
      logger.info("Info message");

      expect(console.debug).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();

      logger.warn("Warning message");
      logger.error("Error message");

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("Warning message"),
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Error message"),
      );
    });

    it("should not log any messages when level is NONE", () => {
      const logger = new Logger({ level: LogLevel.NONE });

      logger.debug("Debug message");
      logger.info("Info message");
      logger.warn("Warning message");
      logger.error("Error message");

      expect(console.debug).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  describe("formatting options", () => {
    it("should include timestamp when timestamp is true", () => {
      const logger = new Logger({ timestamp: true });

      logger.info("Test message");

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining("[2025-06-30T20:04:00.000Z]"),
      );
    });

    it("should not include timestamp when timestamp is false", () => {
      const logger = new Logger({ timestamp: false });

      logger.info("Test message");

      expect(console.info).not.toHaveBeenCalledWith(
        expect.stringContaining("[2025-06-30T20:04:00.000Z]"),
      );
    });

    it("should include log level when showLevel is true", () => {
      const logger = new Logger({ showLevel: true });

      logger.info("Test message");

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining("[INFO]"),
      );
    });

    it("should not include log level when showLevel is false", () => {
      const logger = new Logger({ showLevel: false });

      logger.info("Test message");

      expect(console.info).not.toHaveBeenCalledWith(
        expect.stringContaining("[INFO]"),
      );
    });

    it("should include prefix when prefix is specified", () => {
      const logger = new Logger({ prefix: "TestPrefix" });

      logger.info("Test message");

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining("[TestPrefix]"),
      );
    });

    it("should format message correctly without any formatting options", () => {
      const logger = new Logger({
        timestamp: false,
        showLevel: false,
        prefix: "",
      });

      logger.info("Test message");

      expect(console.info).toHaveBeenCalledWith("Test message");
    });
  });

  describe("child logger", () => {
    it("should create child logger with combined prefix", () => {
      const parent = new Logger({ prefix: "Parent" });
      const child = parent.child("Child");

      child.info("Test message");

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining("[Parent:Child]"),
      );
    });

    it("should create child logger that inherits parent settings", () => {
      const parent = new Logger({
        level: LogLevel.WARN,
        timestamp: false,
        showLevel: true,
      });

      const child = parent.child("Child");

      // Child should inherit parent's level
      child.info("This should not be logged");
      expect(console.info).not.toHaveBeenCalled();

      child.error("This should be logged");
      expect(console.error).toHaveBeenCalledWith(
        expect.not.stringContaining("[2025-06-30T20:04:00.000Z]"), // No timestamp
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("[ERROR]"), // Show level
      );
    });

    it("should create child logger with prefix when parent has no prefix", () => {
      const parent = new Logger();
      const child = parent.child("Child");

      child.info("Test message");

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining("[Child]"),
      );
    });

    it("should support multiple levels of nesting", () => {
      const root = new Logger({ prefix: "Root" });
      const level1 = root.child("Level1");
      const level2 = level1.child("Level2");

      level2.info("Test message");

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining("[Root:Level1:Level2]"),
      );
    });
  });

  describe("defaultLogger", () => {
    it("should be an instance of Logger", () => {
      expect(defaultLogger).toBeInstanceOf(Logger);
    });

    it("should use default settings", () => {
      defaultLogger.info("Test message");
      defaultLogger.error("Error message");

      expect(console.info).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("[ERROR]"),
      );
    });
  });

  describe("getLogLevel", () => {
    it("should return correct LogLevel for valid string", () => {
      expect(getLogLevel("DEBUG")).toBe(LogLevel.DEBUG);
      expect(getLogLevel("INFO")).toBe(LogLevel.INFO);
      expect(getLogLevel("WARN")).toBe(LogLevel.WARN);
      expect(getLogLevel("ERROR")).toBe(LogLevel.ERROR);
      expect(getLogLevel("NONE")).toBe(LogLevel.NONE);
    });

    it("should throw error for invalid string", () => {
      expect(() => getLogLevel("INVALID" as keyof typeof LogLevel)).toThrow(
        "Invalid log level: INVALID",
      );
    });
  });
});
