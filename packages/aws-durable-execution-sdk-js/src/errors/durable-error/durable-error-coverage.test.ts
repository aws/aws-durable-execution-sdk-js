import {
  DurableOperationError,
  StepError,
  CallbackError,
  InvokeError,
} from "./durable-error";

describe("DurableOperationError Coverage Tests", () => {
  describe("fromErrorObject", () => {
    it("should handle unknown error type and default to StepError", () => {
      const errorObject = {
        ErrorType: "UnknownType" as any,
        ErrorMessage: "Unknown error occurred",
        ErrorData: "test-data",
        StackTrace: ["line1", "line2"],
      };

      const result = DurableOperationError.fromErrorObject(errorObject);

      expect(result).toBeInstanceOf(StepError);
      expect(result.message).toBe("Unknown error occurred");
      expect(result.errorData).toBe("test-data");
    });
  });

  describe("Error constructors with default messages", () => {
    it("should use default message for StepError when none provided", () => {
      const error = new StepError();
      expect(error.message).toBe("Step failed");
    });

    it("should use default message for CallbackError when none provided", () => {
      const error = new CallbackError();
      expect(error.message).toBe("Callback failed");
    });

    it("should use default message for InvokeError when none provided", () => {
      const error = new InvokeError();
      expect(error.message).toBe("Invoke failed");
    });
  });
});
