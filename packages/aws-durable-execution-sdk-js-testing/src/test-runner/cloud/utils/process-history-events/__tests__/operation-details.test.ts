import { Operation } from "@aws-sdk/client-lambda";
import { addOperationDetails } from "../operation-details";

describe("addOperationDetails", () => {
  it("should add details to operation when detailsField is provided", () => {
    const operation: Operation = {
      Id: "test-id",
      Name: "test-operation",
    };

    addOperationDetails(operation, "StepDetails", {
      Result: "test result",
      Error: {
        ErrorType: "TestError",
        ErrorMessage: "Test error message",
      },
    });

    expect(operation.StepDetails).toEqual({
      Result: "test result",
      Error: {
        ErrorType: "TestError",
        ErrorMessage: "Test error message",
      },
    });
  });

  it("should merge with existing details", () => {
    const operation: Operation = {
      Id: "test-id",
      Name: "test-operation",
      StepDetails: {
        Attempt: 1,
      },
    };

    addOperationDetails(operation, "StepDetails", {
      Result: "test result",
      NextAttemptTimestamp: new Date("2023-01-01T12:00:00Z"),
    });

    expect(operation.StepDetails).toEqual({
      Attempt: 1,
      Result: "test result",
      NextAttemptTimestamp: new Date("2023-01-01T12:00:00Z"),
    });
  });

  it("should overwrite existing properties with new values", () => {
    const operation: Operation = {
      Id: "test-id",
      Name: "test-operation",
      StepDetails: {
        Result: "old result",
        Attempt: 1,
      },
    };

    addOperationDetails(operation, "StepDetails", {
      Result: "new result",
    });

    expect(operation.StepDetails).toEqual({
      Result: "new result",
      Attempt: 1,
    });
  });

  it("should skip undefined values", () => {
    const operation: Operation = {
      Id: "test-id",
      Name: "test-operation",
      StepDetails: {
        Attempt: 1,
      },
    };

    addOperationDetails(operation, "StepDetails", {
      Result: "test result",
      Attempt: undefined,
      Error: undefined,
      NextAttemptTimestamp: undefined,
    });

    expect(operation.StepDetails).toEqual({
      Attempt: 1,
      Result: "test result",
    });
  });

  it("should do nothing when detailsField is undefined", () => {
    const operation: Operation = {
      Id: "test-id",
      Name: "test-operation",
    };

    const originalOperation = { ...operation };

    addOperationDetails(operation, undefined, {
      Result: "test result",
      Error: {
        ErrorType: "TestError",
        ErrorMessage: "Test error message",
      },
    });

    expect(operation).toEqual(originalOperation);
  });

  it("should handle CallbackDetails", () => {
    const operation: Operation = {
      Id: "test-id",
      Name: "test-operation",
    };

    addOperationDetails(operation, "CallbackDetails", {
      CallbackId: "callback-123",
      Result: "callback result",
    });

    expect(operation.CallbackDetails).toEqual({
      CallbackId: "callback-123",
      Result: "callback result",
    });
  });

  it("should handle WaitDetails", () => {
    const operation: Operation = {
      Id: "test-id",
      Name: "test-operation",
    };

    const scheduledEndTimestamp = new Date("2023-01-01T12:00:00Z");

    addOperationDetails(operation, "WaitDetails", {
      ScheduledEndTimestamp: scheduledEndTimestamp,
    });

    expect(operation.WaitDetails).toEqual({
      ScheduledEndTimestamp: scheduledEndTimestamp,
    });
  });

  it("should handle ChainedInvokeDetails", () => {
    const operation: Operation = {
      Id: "test-id",
      Name: "test-operation",
    };

    addOperationDetails(operation, "ChainedInvokeDetails", {
      Result: "invoke result",
      Error: {
        ErrorType: "InvokeError",
        ErrorMessage: "Invoke failed",
      },
    });

    expect(operation.ChainedInvokeDetails).toEqual({
      Result: "invoke result",
      Error: {
        ErrorType: "InvokeError",
        ErrorMessage: "Invoke failed",
      },
    });
  });

  it("should handle ContextDetails", () => {
    const operation: Operation = {
      Id: "test-id",
      Name: "test-operation",
    };

    addOperationDetails(operation, "ContextDetails", {
      Result: "context result",
      Error: {
        ErrorType: "ContextError",
        ErrorMessage: "Context failed",
      },
    });

    expect(operation.ContextDetails).toEqual({
      Result: "context result",
      Error: {
        ErrorType: "ContextError",
        ErrorMessage: "Context failed",
      },
    });
  });

  it("should handle ExecutionDetails", () => {
    const operation: Operation = {
      Id: "test-id",
      Name: "test-operation",
    };

    // Since ExecutionDetails doesn't have any properties we can add,
    // and addOperationDetails skips undefined values, nothing gets added
    addOperationDetails(operation, "ExecutionDetails", {});

    // ExecutionDetails should remain undefined since no properties were added
    expect(operation.ExecutionDetails).toBeUndefined();
  });

  it("should handle empty property value map", () => {
    const operation: Operation = {
      Id: "test-id",
      Name: "test-operation",
      StepDetails: {
        Attempt: 1,
      },
    };

    addOperationDetails(operation, "StepDetails", {});

    expect(operation.StepDetails).toEqual({
      Attempt: 1,
    });
  });

  it("should create new details object when none exists", () => {
    const operation: Operation = {
      Id: "test-id",
      Name: "test-operation",
    };

    addOperationDetails(operation, "StepDetails", {
      Result: "new result",
      Attempt: 2,
    });

    expect(operation.StepDetails).toEqual({
      Result: "new result",
      Attempt: 2,
    });
  });

  it("should handle complex nested objects", () => {
    const operation: Operation = {
      Id: "test-id",
      Name: "test-operation",
    };

    const complexError = {
      ErrorType: "ComplexError",
      ErrorMessage: "Complex error occurred",
      ErrorData: JSON.stringify({ context: "test", nested: { value: 123 } }),
      StackTrace: ["at test (test.js:1:1)", "at main (main.js:5:5)"],
    };

    addOperationDetails(operation, "StepDetails", {
      Error: complexError,
      Result: JSON.stringify({ success: true, data: [1, 2, 3] }),
    });

    expect(operation.StepDetails).toEqual({
      Error: complexError,
      Result: JSON.stringify({ success: true, data: [1, 2, 3] }),
    });
  });
});
