import { CallbackError } from "./callback-error";
import { ErrorObject } from "@amzn/dex-internal-sdk";

describe("CallbackError", () => {
  describe("Constructor without ErrorObject", () => {
    it("should create error with default message", () => {
      const error = new CallbackError();

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(CallbackError);
      expect(error.message).toBe("Callback failed");
      expect(error.name).toBe("CallbackError"); // CallbackError now sets its name
      expect(error.data).toBeUndefined();
      expect(error.cause).toBeUndefined();
    });

    it("should create error with undefined ErrorObject", () => {
      const error = new CallbackError(undefined);

      expect(error.message).toBe("Callback failed");
      expect(error.data).toBeUndefined();
      expect(error.cause).toBeUndefined();
    });
  });

  describe("Constructor with ErrorObject", () => {
    it("should create error with complete ErrorObject", () => {
      const errorObject: ErrorObject = {
        ErrorMessage: "Test error message",
        ErrorType: "TestError",
        StackTrace: [
          "Error: Test error message",
          "    at test (test.js:1:1)",
          "    at main (main.js:5:5)",
        ],
        ErrorData: "test-data",
      };

      const error = new CallbackError(errorObject);

      expect(error.message).toBe("Callback failed");
      expect(error.data).toBe("test-data");
      expect(error.cause).toBeDefined();
      expect(error.cause!.message).toBe("Test error message");
      expect(error.cause!.name).toBe("TestError");
      expect(error.cause!.stack).toBe(
        "Error: Test error message\n    at test (test.js:1:1)\n    at main (main.js:5:5)",
      );
    });

    it("should create error with minimal ErrorObject", () => {
      const errorObject: ErrorObject = {
        ErrorMessage: "Simple error",
      };

      const error = new CallbackError(errorObject);

      expect(error.message).toBe("Callback failed");
      expect(error.data).toBeUndefined();
      expect(error.cause).toBeDefined();
      expect(error.cause!.message).toBe("Simple error");
      expect(error.cause!.name).toBe("Error"); // Default name
      expect(error.cause!.stack).toBeUndefined();
    });

    it("should handle ErrorObject with only ErrorData", () => {
      const errorObject: ErrorObject = {
        ErrorData: "data-only",
      };

      const error = new CallbackError(errorObject);

      expect(error.message).toBe("Callback failed");
      expect(error.data).toBe("data-only");
      expect(error.cause).toBeDefined(); // Cause is created even without ErrorMessage
      expect(error.cause!.message).toBe(""); // When ErrorMessage is undefined, new Error(undefined) creates empty string message
    });

    it("should handle ErrorObject with ErrorType but default name fallback", () => {
      const errorObject: ErrorObject = {
        ErrorMessage: "Custom error",
        ErrorType: undefined, // Explicitly undefined
      };

      const error = new CallbackError(errorObject);

      expect(error.cause).toBeDefined();
      expect(error.cause!.message).toBe("Custom error");
      expect(error.cause!.name).toBe("Error"); // Falls back to default
    });

    it("should handle ErrorObject with empty StackTrace array", () => {
      const errorObject: ErrorObject = {
        ErrorMessage: "Error with empty stack",
        StackTrace: [],
      };

      const error = new CallbackError(errorObject);

      expect(error.cause).toBeDefined();
      expect(error.cause!.message).toBe("Error with empty stack");
      expect(error.cause!.stack).toBe(""); // Empty string from joining empty array
    });

    it("should handle ErrorObject with single line StackTrace", () => {
      const errorObject: ErrorObject = {
        ErrorMessage: "Single line error",
        StackTrace: ["Error: Single line error"],
      };

      const error = new CallbackError(errorObject);

      expect(error.cause).toBeDefined();
      expect(error.cause!.stack).toBe("Error: Single line error");
    });

    it("should preserve all ErrorObject properties", () => {
      const errorObject: ErrorObject = {
        ErrorMessage: "Full error",
        ErrorType: "CustomError",
        StackTrace: ["Line 1", "Line 2", "Line 3"],
        ErrorData: '{"key": "value"}',
      };

      const error = new CallbackError(errorObject);

      expect(error.message).toBe("Callback failed");
      expect(error.data).toBe('{"key": "value"}');
      expect(error.cause).toBeDefined();
      expect(error.cause!.message).toBe("Full error");
      expect(error.cause!.name).toBe("CustomError");
      expect(error.cause!.stack).toBe("Line 1\nLine 2\nLine 3");
    });
  });

  describe("Edge cases", () => {
    it("should handle ErrorObject with undefined values", () => {
      const errorObject: ErrorObject = {
        ErrorMessage: "Null test",
        ErrorType: undefined,
        StackTrace: undefined,
        ErrorData: undefined,
      };

      const error = new CallbackError(errorObject);

      expect(error.message).toBe("Callback failed");
      expect(error.data).toBeUndefined();
      expect(error.cause).toBeDefined();
      expect(error.cause!.message).toBe("Null test");
      expect(error.cause!.name).toBe("Error");
      expect(error.cause!.stack).toBeUndefined();
    });

    it("should handle ErrorObject with empty string values", () => {
      const errorObject: ErrorObject = {
        ErrorMessage: "",
        ErrorType: "",
        ErrorData: "",
      };

      const error = new CallbackError(errorObject);

      expect(error.message).toBe("Callback failed");
      expect(error.data).toBe("");
      expect(error.cause).toBeDefined();
      expect(error.cause!.message).toBe("");
      expect(error.cause!.name).toBe(""); // Empty string is used as-is, doesn't fallback
    });

    it("should maintain error stack trace", () => {
      const error = new CallbackError();

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("Error"); // Stack trace shows "Error", not "CallbackError"
    });
  });
});
