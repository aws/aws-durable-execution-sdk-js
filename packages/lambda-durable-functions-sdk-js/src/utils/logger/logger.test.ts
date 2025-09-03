import { log } from "./logger";

describe("Logger", () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    // Create a spy on console.log before each test
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore the original console.log after each test
    consoleLogSpy.mockRestore();
  });

  test("should log message when isVerbose is true", () => {
    // Arrange
    const isVerbose = true;
    const emoji = "🚀";
    const message = "Test message";

    // Act
    log(isVerbose, emoji, message);

    // Assert
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith("🚀 Test message", "");
  });

  test("should not log message when isVerbose is false", () => {
    // Arrange
    const isVerbose = false;
    const emoji = "🚀";
    const message = "Test message";

    // Act
    log(isVerbose, emoji, message);

    // Assert
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  test("should log message with stringified data when data is provided", () => {
    // Arrange
    const isVerbose = true;
    const emoji = "📊";
    const message = "Data received";
    const data = { id: 123, name: "test" };

    // Act
    log(isVerbose, emoji, message, data);

    // Assert
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "📊 Data received",
      JSON.stringify(data, null, 2),
    );
  });

  test("should handle complex data structures", () => {
    // Arrange
    const isVerbose = true;
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
    log(isVerbose, emoji, message, complexData);

    // Assert
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "🔄 Complex data",
      JSON.stringify(complexData, null, 2),
    );
  });

  test("should handle null and undefined data", () => {
    // Arrange
    const isVerbose = true;
    const emoji = "⚠️";
    const message = "No data";

    // Act - with undefined
    log(isVerbose, emoji, message, undefined);

    // Assert
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith("⚠️ No data", "");

    // Reset mock
    consoleLogSpy.mockClear();

    // Act - with null
    log(isVerbose, emoji, message, null);

    // Assert
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith("⚠️ No data", "");
  });
});
