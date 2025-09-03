import {
  UnrecoverableError,
  UnrecoverableExecutionError,
  UnrecoverableInvocationError,
  isUnrecoverableError,
  isUnrecoverableExecutionError,
  isUnrecoverableInvocationError,
} from "./unrecoverable-error";
import { TerminationReason } from "../../termination-manager/types";

// Create concrete implementations for testing
class TestUnrecoverableError extends UnrecoverableError {
  readonly terminationReason = TerminationReason.CUSTOM;

  constructor(message: string, originalError?: Error) {
    super(message, originalError);
  }
}

class TestExecutionError extends UnrecoverableExecutionError {
  readonly terminationReason = TerminationReason.CUSTOM;

  constructor(message: string, originalError?: Error) {
    super(message, originalError);
  }
}

class TestInvocationError extends UnrecoverableInvocationError {
  readonly terminationReason = TerminationReason.CUSTOM;

  constructor(message: string, originalError?: Error) {
    super(message, originalError);
  }
}

describe("UnrecoverableError", () => {
  describe("UnrecoverableError base class", () => {
    it("should create error with correct properties", () => {
      const originalError = new Error("Original error");
      const error = new TestUnrecoverableError(
        "Test unrecoverable error",
        originalError,
      );

      expect(error.name).toBe("TestUnrecoverableError");
      expect(error.message).toBe("Test unrecoverable error");
      expect(error.terminationReason).toBe(TerminationReason.CUSTOM);
      expect(error.isUnrecoverable).toBe(true);
      expect(error.originalError).toBe(originalError);
    });

    it("should create error without original error", () => {
      const error = new TestUnrecoverableError("Test error");

      expect(error.message).toBe("Test error");
      expect(error.originalError).toBeUndefined();
    });

    it("should preserve original stack trace", () => {
      const originalError = new Error("Original error");
      const error = new TestUnrecoverableError("Test error", originalError);

      expect(error.stack).toContain("Caused by:");
      expect(error.stack).toContain(originalError.stack);
    });

    it("should not preserve stack trace when original error has no stack", () => {
      const originalError = new Error("Original error");
      originalError.stack = undefined;
      const error = new TestUnrecoverableError("Test error", originalError);

      expect(error.stack).not.toContain("Caused by:");
    });
  });

  describe("UnrecoverableExecutionError", () => {
    it("should create error with correct properties", () => {
      const originalError = new Error("Original error");
      const error = new TestExecutionError(
        "Test execution error",
        originalError,
      );

      expect(error.name).toBe("TestExecutionError");
      expect(error.message).toBe(
        "[Unrecoverable Execution] Test execution error",
      );
      expect(error.terminationReason).toBe(TerminationReason.CUSTOM);
      expect(error.isUnrecoverable).toBe(true);
      expect(error.isUnrecoverableExecution).toBe(true);
      expect(error.originalError).toBe(originalError);
      expect(error).toBeInstanceOf(UnrecoverableError);
      expect(error).toBeInstanceOf(UnrecoverableExecutionError);
    });
  });

  describe("UnrecoverableInvocationError", () => {
    it("should create error with correct properties", () => {
      const originalError = new Error("Original error");
      const error = new TestInvocationError(
        "Test invocation error",
        originalError,
      );

      expect(error.name).toBe("TestInvocationError");
      expect(error.message).toBe(
        "[Unrecoverable Invocation] Test invocation error",
      );
      expect(error.terminationReason).toBe(TerminationReason.CUSTOM);
      expect(error.isUnrecoverable).toBe(true);
      expect(error.isUnrecoverableInvocation).toBe(true);
      expect(error.originalError).toBe(originalError);
      expect(error).toBeInstanceOf(UnrecoverableError);
      expect(error).toBeInstanceOf(UnrecoverableInvocationError);
    });
  });

  describe("isUnrecoverableError", () => {
    it("should return true for UnrecoverableError instances", () => {
      const error = new TestUnrecoverableError("Test error");
      expect(isUnrecoverableError(error)).toBe(true);
    });

    it("should return true for UnrecoverableExecutionError instances", () => {
      const error = new TestExecutionError("Test error");
      expect(isUnrecoverableError(error)).toBe(true);
    });

    it("should return true for UnrecoverableInvocationError instances", () => {
      const error = new TestInvocationError("Test error");
      expect(isUnrecoverableError(error)).toBe(true);
    });

    it("should return false for regular Error", () => {
      const error = new Error("Regular error");
      expect(isUnrecoverableError(error)).toBe(false);
    });

    it("should return false for non-Error objects", () => {
      expect(isUnrecoverableError("string")).toBe(false);
      expect(isUnrecoverableError(null)).toBe(false);
      expect(isUnrecoverableError(undefined)).toBe(false);
      expect(isUnrecoverableError({})).toBe(false);
      expect(isUnrecoverableError(123)).toBe(false);
    });

    it("should return false for Error with isUnrecoverable = false", () => {
      const error = new Error("Test error");
      (error as any).isUnrecoverable = false;
      expect(isUnrecoverableError(error)).toBe(false);
    });

    it("should return false for Error without isUnrecoverable property", () => {
      const error = new Error("Test error");
      expect(isUnrecoverableError(error)).toBe(false);
    });
  });

  describe("isUnrecoverableExecutionError", () => {
    it("should return true for UnrecoverableExecutionError instances", () => {
      const error = new TestExecutionError("Test error");
      expect(isUnrecoverableExecutionError(error)).toBe(true);
    });

    it("should return false for UnrecoverableInvocationError instances", () => {
      const error = new TestInvocationError("Test error");
      expect(isUnrecoverableExecutionError(error)).toBe(false);
    });

    it("should return false for base UnrecoverableError instances", () => {
      const error = new TestUnrecoverableError("Test error");
      expect(isUnrecoverableExecutionError(error)).toBe(false);
    });

    it("should return false for regular Error", () => {
      const error = new Error("Regular error");
      expect(isUnrecoverableExecutionError(error)).toBe(false);
    });
  });

  describe("isUnrecoverableInvocationError", () => {
    it("should return true for UnrecoverableInvocationError instances", () => {
      const error = new TestInvocationError("Test error");
      expect(isUnrecoverableInvocationError(error)).toBe(true);
    });

    it("should return false for UnrecoverableExecutionError instances", () => {
      const error = new TestExecutionError("Test error");
      expect(isUnrecoverableInvocationError(error)).toBe(false);
    });

    it("should return false for base UnrecoverableError instances", () => {
      const error = new TestUnrecoverableError("Test error");
      expect(isUnrecoverableInvocationError(error)).toBe(false);
    });

    it("should return false for regular Error", () => {
      const error = new Error("Regular error");
      expect(isUnrecoverableInvocationError(error)).toBe(false);
    });
  });
});
