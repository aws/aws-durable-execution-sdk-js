import { ErrorObject } from "@aws-sdk/client-lambda";
import {
  DurableOperationError,
  StepError,
  CallbackError,
  InvokeError,
} from "./durable-error";

describe("DurableOperationError", () => {
  describe("StepError", () => {
    it("should create StepError with cause", () => {
      const originalError = new Error("Original error");
      originalError.stack = "Original stack trace";

      const stepError = new StepError(
        "Step failed",
        originalError,
        "error-data",
      );

      expect(stepError).toBeInstanceOf(StepError);
      expect(stepError).toBeInstanceOf(DurableOperationError);
      expect(stepError.errorType).toBe("StepError");
      expect(stepError.message).toBe("Step failed");
      expect(stepError.cause).toBe(originalError);
      expect(stepError.errorData).toBe("error-data");
    });

    it("should serialize to ErrorObject", () => {
      const originalError = new Error("Original error");
      originalError.stack = "line1\nline2\nline3";

      const stepError = new StepError(
        "Step failed",
        originalError,
        "error-data",
      );
      const errorObject = stepError.toErrorObject();

      expect(errorObject).toEqual({
        ErrorType: "StepError",
        ErrorMessage: "Step failed",
        ErrorData: "error-data",
        StackTrace: ["line1", "line2", "line3"],
      });
    });

    it("should reconstruct from ErrorObject", () => {
      const errorObject: ErrorObject = {
        ErrorType: "StepError",
        ErrorMessage: "Step failed",
        ErrorData: "error-data",
        StackTrace: ["line1", "line2", "line3"],
      };

      const reconstructed = DurableOperationError.fromErrorObject(errorObject);

      expect(reconstructed).toBeInstanceOf(StepError);
      expect(reconstructed.errorType).toBe("StepError");
      expect(reconstructed.message).toBe("Step failed");
      expect(reconstructed.errorData).toBe("error-data");
      expect(reconstructed.cause?.stack).toBe("line1\nline2\nline3");
    });
  });

  describe("CallbackError", () => {
    it("should create CallbackError with cause", () => {
      const originalError = new Error("Callback timeout");
      const callbackError = new CallbackError("Callback failed", originalError);

      expect(callbackError).toBeInstanceOf(CallbackError);
      expect(callbackError).toBeInstanceOf(DurableOperationError);
      expect(callbackError.errorType).toBe("CallbackError");
      expect(callbackError.cause).toBe(originalError);
    });

    it("should reconstruct from ErrorObject", () => {
      const errorObject: ErrorObject = {
        ErrorType: "CallbackError",
        ErrorMessage: "Callback timeout",
        ErrorData: "timeout-data",
      };

      const reconstructed = CallbackError.fromErrorObject(errorObject);

      expect(reconstructed).toBeInstanceOf(CallbackError);
      expect(reconstructed.message).toBe("Callback timeout");
      expect(reconstructed.errorData).toBe("timeout-data");
    });
  });

  describe("InvokeError", () => {
    it("should create InvokeError with cause", () => {
      const originalError = new Error("Lambda invocation failed");
      const invokeError = new InvokeError("Invoke failed", originalError);

      expect(invokeError).toBeInstanceOf(InvokeError);
      expect(invokeError).toBeInstanceOf(DurableOperationError);
      expect(invokeError.errorType).toBe("InvokeError");
      expect(invokeError.cause).toBe(originalError);
    });
  });

  describe("instanceof behavior", () => {
    it("should preserve instanceof checks across reconstruction", () => {
      // Create original error
      const stepError = new StepError("Test error");
      const errorObject = stepError.toErrorObject();

      // Reconstruct error
      const reconstructed = DurableOperationError.fromErrorObject(errorObject);

      // Verify instanceof behavior is preserved
      expect(reconstructed instanceof StepError).toBe(true);
      expect(reconstructed instanceof DurableOperationError).toBe(true);
      expect(reconstructed instanceof Error).toBe(true);
    });
  });
});
