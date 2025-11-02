import {
  StepError,
  CallbackError,
  InvokeError,
  DurableOperationError,
} from "./durable-error";
import { ErrorObject } from "@aws-sdk/client-lambda";

describe("Error Determinism Integration Tests", () => {
  describe("Step Error Determinism", () => {
    it("should preserve instanceof behavior across serialization/deserialization", () => {
      class MyCustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "MyCustomError";
        }
      }

      // Simulate what happens when a step fails
      const originalError = new MyCustomError("User not found");
      const stepError = new StepError(
        "Step 'fetch-user' failed: User not found",
        originalError,
      );

      // Serialize to ErrorObject (what gets stored)
      const errorObject = stepError.toErrorObject();

      // Deserialize from ErrorObject (what happens during replay)
      const reconstructedError =
        DurableOperationError.fromErrorObject(errorObject);

      // Verify deterministic behavior
      expect(reconstructedError instanceof StepError).toBe(true);
      expect(reconstructedError instanceof DurableOperationError).toBe(true);
      expect(reconstructedError instanceof Error).toBe(true);

      // Original error information is preserved in the cause
      expect(reconstructedError.cause?.message).toBe(
        "Step 'fetch-user' failed: User not found",
      );
      expect(reconstructedError.cause?.name).toBe("StepError");

      // This demonstrates that error handling can now be deterministic:
      // Both initial run and replay will have the same error type and structure
    });
  });

  describe("Error Type Consistency", () => {
    it("should maintain consistent error types across all operations", () => {
      // Step errors are wrapped in StepError
      const stepError = new StepError("Step failed", new Error("Original"));
      expect(stepError instanceof StepError).toBe(true);
      expect(stepError instanceof Error).toBe(true);
      expect(stepError.errorType).toBe("StepError");

      // Callback errors use CallbackError
      const callbackError = new CallbackError(
        "Callback failed",
        new Error("Timeout"),
      );
      expect(callbackError instanceof CallbackError).toBe(true);
      expect(callbackError instanceof Error).toBe(true);
      expect(callbackError.errorType).toBe("CallbackError");

      // Invoke errors use InvokeError
      const invokeError = new InvokeError(
        "Invoke failed",
        new Error("Lambda error"),
      );
      expect(invokeError instanceof InvokeError).toBe(true);
      expect(invokeError instanceof Error).toBe(true);
      expect(invokeError.errorType).toBe("InvokeError");
    });

    it("should serialize and deserialize errors consistently", () => {
      const originalError = new Error("Test error");
      originalError.stack = "Error: Test error\n    at test.js:1:1";

      const stepError = new StepError(
        "Step failed",
        originalError,
        "test-data",
      );

      // Serialize to ErrorObject
      const errorObject = stepError.toErrorObject();
      expect(errorObject.ErrorType).toBe("StepError");
      expect(errorObject.ErrorMessage).toBe("Step failed");
      expect(errorObject.ErrorData).toBe("test-data");

      // Deserialize back to DurableOperationError
      const reconstructed = DurableOperationError.fromErrorObject(errorObject);
      expect(reconstructed instanceof StepError).toBe(true);
      expect(reconstructed.message).toBe("Step failed");
      expect(reconstructed.errorData).toBe("test-data");
      expect(reconstructed.cause?.message).toBe("Step failed");
    });
  });

  describe("Error Information Preservation", () => {
    it("should preserve all error details for debugging", () => {
      const originalError = new Error("Database connection failed");
      originalError.stack =
        "Error: Database connection failed\n    at db.connect(db.js:45:12)\n    at handler(index.js:10:5)";

      const stepError = new StepError(
        "Failed to connect to database",
        originalError,
        '{"connectionString": "redacted", "timeout": 5000}',
      );

      // All information should be preserved
      expect(stepError.message).toBe("Failed to connect to database");
      expect(stepError.cause?.message).toBe("Database connection failed");
      expect(stepError.cause?.stack).toContain("db.connect(db.js:45:12)");
      expect(stepError.errorData).toBe(
        '{"connectionString": "redacted", "timeout": 5000}',
      );

      // Should be serializable for storage
      const errorObject = stepError.toErrorObject();
      expect(errorObject.StackTrace).toContain(
        "Error: Database connection failed",
      );
      expect(errorObject.StackTrace).toContain(
        "    at db.connect(db.js:45:12)",
      );
    });

    it("should handle callback errors with complete error information", () => {
      const errorObject: ErrorObject = {
        ErrorType: "CallbackError",
        ErrorMessage: "Callback timeout",
        ErrorData: '{"timeoutMs": 30000}',
        StackTrace: [
          "Error: Callback timeout",
          "    at timeout (callback.js:15:10)",
          "    at Timer.setTimeout (timer.js:100:5)",
        ],
      };

      const callbackError = CallbackError.fromErrorObject(errorObject);

      expect(callbackError instanceof CallbackError).toBe(true);
      expect(callbackError.message).toBe("Callback timeout");
      expect(callbackError.errorData).toBe('{"timeoutMs": 30000}');
      expect(callbackError.cause?.stack).toBe(
        "Error: Callback timeout\n    at timeout (callback.js:15:10)\n    at Timer.setTimeout (timer.js:100:5)",
      );
    });

    it("should handle invoke errors with lambda error details", () => {
      const invokeError = new InvokeError(
        "Lambda invocation failed",
        new Error("Function timeout"),
        '{"functionName": "myFunction", "requestId": "abc-123"}',
      );

      const errorObject = invokeError.toErrorObject();
      const reconstructed = DurableOperationError.fromErrorObject(errorObject);

      expect(reconstructed instanceof InvokeError).toBe(true);
      expect(reconstructed.message).toBe("Lambda invocation failed");
      expect(reconstructed.errorData).toBe(
        '{"functionName": "myFunction", "requestId": "abc-123"}',
      );
      expect(reconstructed.cause?.message).toBe("Lambda invocation failed");
    });
  });

  describe("Backward Compatibility", () => {
    it("should handle legacy error objects without specific error types", () => {
      const legacyErrorObject: ErrorObject = {
        ErrorMessage: "Unknown error type",
        ErrorType: "SomeUnknownError",
      };

      // Should default to StepError for unknown types
      const reconstructed =
        DurableOperationError.fromErrorObject(legacyErrorObject);
      expect(reconstructed instanceof StepError).toBe(true);
      expect(reconstructed.message).toBe("Unknown error type");
    });
  });
});
