import {
  CheckpointUnrecoverableInvocationError,
  CheckpointUnrecoverableExecutionError,
} from "./checkpoint-errors";
import {
  UnrecoverableError,
  UnrecoverableInvocationError,
  UnrecoverableExecutionError,
  isUnrecoverableError,
  isUnrecoverableInvocationError,
  isUnrecoverableExecutionError,
} from "../unrecoverable-error/unrecoverable-error";
import { TerminationReason } from "../../termination-manager/types";

describe("CheckpointUnrecoverableInvocationError", () => {
  it("should create error with default message", () => {
    const error = new CheckpointUnrecoverableInvocationError();

    expect(error.name).toBe("CheckpointUnrecoverableInvocationError");
    expect(error.message).toBe(
      "[Unrecoverable Invocation] Checkpoint operation failed",
    );
    expect(error.terminationReason).toBe(TerminationReason.CHECKPOINT_FAILED);
    expect(error.isUnrecoverable).toBe(true);
    expect(error.isUnrecoverableInvocation).toBe(true);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(error).toBeInstanceOf(UnrecoverableInvocationError);
  });

  it("should create error with custom message", () => {
    const error = new CheckpointUnrecoverableInvocationError(
      "Custom checkpoint error",
    );

    expect(error.message).toBe(
      "[Unrecoverable Invocation] Custom checkpoint error",
    );
    expect(error.terminationReason).toBe(TerminationReason.CHECKPOINT_FAILED);
    expect(error.isUnrecoverable).toBe(true);
    expect(error.isUnrecoverableInvocation).toBe(true);
  });

  it("should create error with original error", () => {
    const originalError = new Error("5xx server error");
    const error = new CheckpointUnrecoverableInvocationError(
      "Checkpoint failed",
      originalError,
    );

    expect(error.message).toBe("[Unrecoverable Invocation] Checkpoint failed");
    expect(error.originalError).toBe(originalError);
    expect(error.stack).toContain("Caused by:");
    expect(error.stack).toContain(originalError.stack);
  });

  it("should be detected by isUnrecoverableError", () => {
    const error = new CheckpointUnrecoverableInvocationError();
    expect(isUnrecoverableError(error)).toBe(true);
    expect(isUnrecoverableInvocationError(error)).toBe(true);
    expect(isUnrecoverableExecutionError(error)).toBe(false);
  });
});

describe("CheckpointUnrecoverableExecutionError", () => {
  it("should create error with default message", () => {
    const error = new CheckpointUnrecoverableExecutionError();

    expect(error.name).toBe("CheckpointUnrecoverableExecutionError");
    expect(error.message).toBe(
      "[Unrecoverable Execution] Checkpoint operation failed",
    );
    expect(error.terminationReason).toBe(TerminationReason.CHECKPOINT_FAILED);
    expect(error.isUnrecoverable).toBe(true);
    expect(error.isUnrecoverableExecution).toBe(true);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(error).toBeInstanceOf(UnrecoverableExecutionError);
  });

  it("should create error with custom message", () => {
    const error = new CheckpointUnrecoverableExecutionError(
      "Custom checkpoint error",
    );

    expect(error.message).toBe(
      "[Unrecoverable Execution] Custom checkpoint error",
    );
    expect(error.terminationReason).toBe(TerminationReason.CHECKPOINT_FAILED);
    expect(error.isUnrecoverable).toBe(true);
    expect(error.isUnrecoverableExecution).toBe(true);
  });

  it("should create error with original error", () => {
    const originalError = new Error("Invalid parameter");
    const error = new CheckpointUnrecoverableExecutionError(
      "Checkpoint failed",
      originalError,
    );

    expect(error.message).toBe("[Unrecoverable Execution] Checkpoint failed");
    expect(error.originalError).toBe(originalError);
    expect(error.stack).toContain("Caused by:");
    expect(error.stack).toContain(originalError.stack);
  });

  it("should be detected by isUnrecoverableError", () => {
    const error = new CheckpointUnrecoverableExecutionError();
    expect(isUnrecoverableError(error)).toBe(true);
    expect(isUnrecoverableExecutionError(error)).toBe(true);
    expect(isUnrecoverableInvocationError(error)).toBe(false);
  });
});
