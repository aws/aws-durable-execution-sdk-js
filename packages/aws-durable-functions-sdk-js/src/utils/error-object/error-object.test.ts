import { createErrorObjectFromError } from "./error-object";

describe("createErrorObjectFromError", () => {
  describe("With Error instances", () => {
    it("should create ErrorObject from standard Error with message and stack", () => {
      const error = new Error("Test error message");
      const result = createErrorObjectFromError(error);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Test error message",
        ErrorType: "Error",
        StackTrace: error.stack?.split(/\r?\n/),
      });
    });

    it("should create ErrorObject from Error with custom name", () => {
      const error = new Error("Custom error message");
      error.name = "CustomError";

      const result = createErrorObjectFromError(error);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Custom error message",
        ErrorType: "CustomError",
        StackTrace: error.stack?.split(/\r?\n/),
      });
    });

    it("should create ErrorObject from Error without stack trace", () => {
      const error = new Error("No stack error");
      error.stack = undefined;

      const result = createErrorObjectFromError(error);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "No stack error",
        ErrorType: "Error",
        StackTrace: undefined,
      });
    });

    it("should create ErrorObject from Error with empty stack trace", () => {
      const error = new Error("Empty stack error");
      error.stack = "";

      const result = createErrorObjectFromError(error);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Empty stack error",
        ErrorType: "Error",
        StackTrace: [""],
      });
    });

    it("should create ErrorObject from custom Error subclass", () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "CustomError";
        }
      }

      const error = new CustomError("Custom subclass error");
      const result = createErrorObjectFromError(error);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Custom subclass error",
        ErrorType: "CustomError",
        StackTrace: error.stack?.split(/\r?\n/),
      });
    });

    it("should create ErrorObject from TypeError", () => {
      const error = new TypeError("Type error message");
      const result = createErrorObjectFromError(error);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Type error message",
        ErrorType: "TypeError",
        StackTrace: error.stack?.split(/\r?\n/),
      });
    });

    it("should create ErrorObject from ReferenceError", () => {
      const error = new ReferenceError("Reference error message");
      const result = createErrorObjectFromError(error);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Reference error message",
        ErrorType: "ReferenceError",
        StackTrace: error.stack?.split(/\r?\n/),
      });
    });
  });

  describe("With data parameter", () => {
    it("should include data when provided", () => {
      const error = new Error("Error with data");
      const data = "test-data";

      const result = createErrorObjectFromError(error, data);

      expect(result).toEqual({
        ErrorData: "test-data",
        ErrorMessage: "Error with data",
        ErrorType: "Error",
        StackTrace: error.stack?.split(/\r?\n/),
      });
    });

    it("should include JSON data when provided", () => {
      const error = new Error("Error with JSON data");
      const data = '{"key": "value", "number": 42}';

      const result = createErrorObjectFromError(error, data);

      expect(result).toEqual({
        ErrorData: '{"key": "value", "number": 42}',
        ErrorMessage: "Error with JSON data",
        ErrorType: "Error",
        StackTrace: error.stack?.split(/\r?\n/),
      });
    });

    it("should include empty string data when provided", () => {
      const error = new Error("Error with empty data");
      const data = "";

      const result = createErrorObjectFromError(error, data);

      expect(result).toEqual({
        ErrorData: "",
        ErrorMessage: "Error with empty data",
        ErrorType: "Error",
        StackTrace: error.stack?.split(/\r?\n/),
      });
    });

    it("should handle undefined data explicitly", () => {
      const error = new Error("Error with undefined data");

      const result = createErrorObjectFromError(error, undefined);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Error with undefined data",
        ErrorType: "Error",
        StackTrace: error.stack?.split(/\r?\n/),
      });
    });
  });

  describe("With non-Error values", () => {
    it("should handle string values", () => {
      const result = createErrorObjectFromError("string error");

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Unknown error",
      });
    });

    it("should handle string values with data", () => {
      const result = createErrorObjectFromError("string error", "test-data");

      expect(result).toEqual({
        ErrorData: "test-data",
        ErrorMessage: "Unknown error",
      });
    });

    it("should handle number values", () => {
      const result = createErrorObjectFromError(42);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Unknown error",
      });
    });

    it("should handle boolean values", () => {
      const result = createErrorObjectFromError(true);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Unknown error",
      });
    });

    it("should handle object values", () => {
      const result = createErrorObjectFromError({ message: "Not an error" });

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Unknown error",
      });
    });

    it("should handle array values", () => {
      const result = createErrorObjectFromError(["not", "an", "error"]);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Unknown error",
      });
    });

    it("should handle null values", () => {
      const result = createErrorObjectFromError(null);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Unknown error",
      });
    });

    it("should handle undefined values", () => {
      const result = createErrorObjectFromError(undefined);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Unknown error",
      });
    });
  });

  describe("Stack trace formatting", () => {
    it("should split multi-line stack traces correctly", () => {
      const error = new Error("Multi-line stack error");
      error.stack =
        "Error: Multi-line stack error\n    at test (test.js:1:1)\n    at main (main.js:5:5)";

      const result = createErrorObjectFromError(error);

      expect(result.StackTrace).toEqual([
        "Error: Multi-line stack error",
        "    at test (test.js:1:1)",
        "    at main (main.js:5:5)",
      ]);
    });

    it("should handle single line stack traces", () => {
      const error = new Error("Single line error");
      error.stack = "Error: Single line error";

      const result = createErrorObjectFromError(error);

      expect(result.StackTrace).toEqual(["Error: Single line error"]);
    });

    it("should handle stack traces with Windows line endings", () => {
      const error = new Error("Windows line endings");
      error.stack =
        "Error: Windows line endings\r\n    at test (test.js:1:1)\r\n    at main (main.js:5:5)";

      const result = createErrorObjectFromError(error);

      expect(result.StackTrace).toEqual([
        "Error: Windows line endings",
        "    at test (test.js:1:1)",
        "    at main (main.js:5:5)",
      ]);
    });

    it("should handle stack traces with mixed line endings", () => {
      const error = new Error("Mixed line endings");
      error.stack =
        "Error: Mixed line endings\n    at test (test.js:1:1)\r\n    at main (main.js:5:5)";

      const result = createErrorObjectFromError(error);

      expect(result.StackTrace).toEqual([
        "Error: Mixed line endings",
        "    at test (test.js:1:1)",
        "    at main (main.js:5:5)",
      ]);
    });
  });

  describe("Error-like objects", () => {
    it("should treat error-like objects as Error instances", () => {
      const errorLike = {
        message: "I look like an error",
        name: "FakeError",
        stack: "FakeError: I look like an error\n    at fake (fake.js:1:1)",
      };

      const result = createErrorObjectFromError(errorLike);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "I look like an error",
        ErrorType: "FakeError",
        StackTrace: [
          "FakeError: I look like an error",
          "    at fake (fake.js:1:1)",
        ],
      });
    });

    it("should treat inherited objects as Error instances", () => {
      // Create an object that has Error in its prototype chain but isn't an actual Error
      const fakeError = Object.create(Error.prototype);
      fakeError.message = "Fake inheritance";
      fakeError.name = "FakeError";

      const result = createErrorObjectFromError(fakeError);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Fake inheritance",
        ErrorType: "FakeError",
        StackTrace: undefined,
      });
    });

    it("should handle error-like objects without stack trace", () => {
      const errorLike = {
        message: "Error without stack",
        name: "SimpleError",
      };

      const result = createErrorObjectFromError(errorLike);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Error without stack",
        ErrorType: "SimpleError",
        StackTrace: undefined,
      });
    });

    it("should not treat objects without required properties as error-like", () => {
      const notErrorLike = {
        message: "Has message but no name",
      };

      const result = createErrorObjectFromError(notErrorLike);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Unknown error",
      });
    });

    it("should not treat objects without message as error-like", () => {
      const notErrorLike = {
        name: "HasName",
      };

      const result = createErrorObjectFromError(notErrorLike);

      expect(result).toEqual({
        ErrorData: undefined,
        ErrorMessage: "Unknown error",
      });
    });
  });
});
