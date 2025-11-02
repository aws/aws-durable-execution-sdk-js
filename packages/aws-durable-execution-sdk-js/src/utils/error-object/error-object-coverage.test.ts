import { createErrorObjectFromError } from "./error-object";
import { StepError } from "../../errors/durable-error/durable-error";

describe("Error Object Coverage Tests", () => {
  it("should handle DurableOperationError with additional data parameter", () => {
    const stepError = new StepError("Test error", undefined, "original-data");
    const result = createErrorObjectFromError(stepError, "additional-data");

    expect(result.ErrorType).toBe("StepError");
    expect(result.ErrorMessage).toBe("Test error");
    expect(result.ErrorData).toBe("additional-data");
  });
});
