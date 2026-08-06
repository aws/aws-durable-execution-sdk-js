import {
  CallbackError,
  CallbackExternalError,
  CallbackTimeoutError,
  CallbackSubmitterError,
  DurableOperationError,
} from "../../errors/durable-error/durable-error";
import { ErrorObject } from "../../types/wire";

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

describe("Callback error hierarchy", () => {
  it("CallbackExternalError should be a CallbackError", () => {
    const error = new CallbackExternalError();

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DurableOperationError);
    expect(error).toBeInstanceOf(CallbackError);
    expect(error).toBeInstanceOf(CallbackExternalError);
    expect(error.name).toBe("CallbackExternalError");
    expect(error.errorType).toBe("CallbackExternalError");
    expect(error.message).toBe("Callback failed");
  });

  it("CallbackTimeoutError should be a CallbackError", () => {
    const error = new CallbackTimeoutError();

    expect(error).toBeInstanceOf(CallbackError);
    expect(error).toBeInstanceOf(CallbackTimeoutError);
    expect(error.errorType).toBe("CallbackTimeoutError");
    expect(error.message).toBe("Callback timed out");
  });

  it("CallbackSubmitterError should be a CallbackError", () => {
    const error = new CallbackSubmitterError();

    expect(error).toBeInstanceOf(CallbackError);
    expect(error).toBeInstanceOf(CallbackSubmitterError);
    expect(error.errorType).toBe("CallbackSubmitterError");
    expect(error.message).toBe("Callback submitter failed");
  });

  it("base CallbackError should not be an instance of its subclasses", () => {
    const error = new CallbackError();

    expect(error).toBeInstanceOf(CallbackError);
    expect(error).not.toBeInstanceOf(CallbackExternalError);
    expect(error).not.toBeInstanceOf(CallbackTimeoutError);
    expect(error).not.toBeInstanceOf(CallbackSubmitterError);
    expect(error.errorType).toBe("CallbackError");
  });

  it("should reconstruct CallbackExternalError from ErrorObject preserving the subtype", () => {
    const errorObject: ErrorObject = {
      ErrorType: "CallbackExternalError",
      ErrorMessage: "External system reported failure",
      ErrorData: "external-data",
    };

    const error = DurableOperationError.fromErrorObject(errorObject);

    expect(error).toBeInstanceOf(CallbackExternalError);
    expect(error).toBeInstanceOf(CallbackError);
    expect(error.errorType).toBe("CallbackExternalError");
    expect(error.message).toBe("External system reported failure");
    expect(error.errorData).toBe("external-data");
  });
});
