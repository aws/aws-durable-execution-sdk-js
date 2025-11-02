import { CallbackError } from "../../errors/durable-error/durable-error";
import { ErrorObject } from "@aws-sdk/client-lambda";

describe("CallbackError", () => {
  describe("Constructor", () => {
    it("should create error with default message", () => {
      const error = new CallbackError();

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(CallbackError);
      expect(error.message).toBe("Callback failed");
      expect(error.name).toBe("CallbackError");
      expect(error.errorData).toBeUndefined();
      expect(error.cause).toBeUndefined();
    });

    it("should create error with custom message", () => {
      const error = new CallbackError("Custom callback error");

      expect(error.message).toBe("Custom callback error");
      expect(error.errorData).toBeUndefined();
      expect(error.cause).toBeUndefined();
    });

    it("should create error with cause", () => {
      const cause = new Error("Original error");
      const error = new CallbackError("Callback failed", cause);

      expect(error.message).toBe("Callback failed");
      expect(error.cause).toBe(cause);
      expect(error.errorData).toBeUndefined();
    });

    it("should create error with all parameters", () => {
      const cause = new Error("Original error");
      const error = new CallbackError("Callback failed", cause, "error-data");

      expect(error.message).toBe("Callback failed");
      expect(error.cause).toBe(cause);
      expect(error.errorData).toBe("error-data");
    });
  });

  describe("fromErrorObject", () => {
    it("should create error from complete ErrorObject", () => {
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

      const error = CallbackError.fromErrorObject(errorObject);

      expect(error.message).toBe("Test error message");
      expect(error.errorData).toBe("test-data");
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

      const error = CallbackError.fromErrorObject(errorObject);

      expect(error.message).toBe("Simple error");
      expect(error.errorData).toBeUndefined();
      expect(error.cause).toBeDefined();
      expect(error.cause!.message).toBe("Simple error");
      expect(error.cause!.name).toBe("Error");
      expect(error.cause!.stack).toBeUndefined();
    });
  });
});
