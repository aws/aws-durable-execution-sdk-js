import { log } from "./logger";

describe("Logger", () => {
  let consoleLogSpy: jest.SpyInstance;
  const originalEnv = process.env.DURABLE_VERBOSE_MODE;

  beforeEach(() => {
    // Create a spy on console.log before each test
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore the original console.log after each test
    consoleLogSpy.mockRestore();
    // Restore original environment variable
    if (originalEnv !== undefined) {
      process.env.DURABLE_VERBOSE_MODE = originalEnv;
    } else {
      delete process.env.DURABLE_VERBOSE_MODE;
    }
  });

  test("should log message when DURABLE_VERBOSE_MODE is true", () => {
    // Arrange
    process.env.DURABLE_VERBOSE_MODE = "true";
    const emoji = "🚀";
    const message = "Test message";

    // Act
    log(emoji, message);

    // Assert
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith("🚀 Test message", "");
  });

  test("should not log message when DURABLE_VERBOSE_MODE is false", () => {
    // Arrange
    process.env.DURABLE_VERBOSE_MODE = "false";
    const emoji = "🚀";
    const message = "Test message";

    // Act
    log(emoji, message);

    // Assert
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  test("should not log message when DURABLE_VERBOSE_MODE is undefined", () => {
    // Arrange
    delete process.env.DURABLE_VERBOSE_MODE;
    const emoji = "🚀";
    const message = "Test message";

    // Act
    log(emoji, message);

    // Assert
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  test("should log message with stringified data when data is provided", () => {
    // Arrange
    process.env.DURABLE_VERBOSE_MODE = "true";
    const emoji = "📊";
    const message = "Data received";
    const data = { id: 123, name: "test" };

    // Act
    log(emoji, message, data);

    // Assert
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "📊 Data received",
      JSON.stringify(data, null, 2),
    );
  });

  test("should handle complex data structures", () => {
    // Arrange
    process.env.DURABLE_VERBOSE_MODE = "true";
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
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "🔄 Complex data",
      JSON.stringify(complexData, null, 2),
    );
  });

  test("should handle null and undefined data", () => {
    // Arrange
    process.env.DURABLE_VERBOSE_MODE = "true";
    const emoji = "⚠️";
    const message = "No data";

    // Act - with undefined
    log(emoji, message, undefined);

    // Assert
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith("⚠️ No data", "");

    // Reset mock
    consoleLogSpy.mockClear();

    // Act - with null
    log(emoji, message, null);

    // Assert
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith("⚠️ No data", "");
  });
});
