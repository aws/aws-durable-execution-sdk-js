import { log, refreshLogConfig } from "./logger";

describe("Logger", () => {
  let consoleDebugSpy: jest.SpyInstance;
  const originalEnv = process.env.DURABLE_VERBOSE_MODE;

  beforeEach(() => {
    // Create a spy on console.debug before each test
    consoleDebugSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore the original console.debug after each test
    consoleDebugSpy.mockRestore();
    // Restore original environment variable
    if (originalEnv !== undefined) {
      process.env.DURABLE_VERBOSE_MODE = originalEnv;
    } else {
      delete process.env.DURABLE_VERBOSE_MODE;
    }
    refreshLogConfig();
  });

  test("should log message when DURABLE_VERBOSE_MODE is true", () => {
    // Arrange
    process.env.DURABLE_VERBOSE_MODE = "true";
    refreshLogConfig();
    const emoji = "🚀";
    const message = "Test message";

    // Act
    log(emoji, message);

    // Assert
    expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
    expect(consoleDebugSpy).toHaveBeenCalledWith("🚀 Test message", "");
  });

  test("should not log message when DURABLE_VERBOSE_MODE is false", () => {
    // Arrange
    process.env.DURABLE_VERBOSE_MODE = "false";
    refreshLogConfig();
    const emoji = "🚀";
    const message = "Test message";

    // Act
    log(emoji, message);

    // Assert
    expect(consoleDebugSpy).not.toHaveBeenCalled();
  });

  test("should not log message when DURABLE_VERBOSE_MODE is undefined", () => {
    // Arrange
    delete process.env.DURABLE_VERBOSE_MODE;
    refreshLogConfig();
    const emoji = "🚀";
    const message = "Test message";

    // Act
    log(emoji, message);

    // Assert
    expect(consoleDebugSpy).not.toHaveBeenCalled();
  });

  test("should log message with stringified data when data is provided", () => {
    // Arrange
    process.env.DURABLE_VERBOSE_MODE = "true";
    refreshLogConfig();
    const emoji = "📊";
    const message = "Data received";
    const data = { id: 123, name: "test" };

    // Act
    log(emoji, message, data);

    // Assert
    expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
    expect(consoleDebugSpy).toHaveBeenCalledWith(
      "📊 Data received",
      JSON.stringify(data, null, 2),
    );
  });

  test("should handle complex data structures", () => {
    // Arrange
    process.env.DURABLE_VERBOSE_MODE = "true";
    refreshLogConfig();
    const emoji = "🔄";
    const message = "Complex data";
    const complexData = {
      nested: {
        array: [1, 2, 3],
        object: { key: "value" },
      },
      date: new Date("2023-01-01"),
    };

    // Act
    log(emoji, message, complexData);

    // Assert
    expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
    expect(consoleDebugSpy).toHaveBeenCalledWith(
      "🔄 Complex data",
      JSON.stringify(complexData, null, 2),
    );
  });

  test("should handle null and undefined data", () => {
    // Arrange
    process.env.DURABLE_VERBOSE_MODE = "true";
    refreshLogConfig();
    const emoji = "⚠️";
    const message = "No data";

    // Act - with undefined
    log(emoji, message, undefined);

    // Assert
    expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
    expect(consoleDebugSpy).toHaveBeenCalledWith("⚠️ No data", "");

    // Reset mock
    consoleDebugSpy.mockClear();

    // Act - with null
    log(emoji, message, null);

    // Assert
    expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
    expect(consoleDebugSpy).toHaveBeenCalledWith("⚠️ No data", "");
  });
});
