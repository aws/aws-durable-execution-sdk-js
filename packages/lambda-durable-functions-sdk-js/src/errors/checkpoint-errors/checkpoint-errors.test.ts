import { CheckpointFailedError } from "./checkpoint-errors";
import {
  UnrecoverableError,
  UnrecoverableInvocationError,
  isUnrecoverableError,
} from "../unrecoverable-error/unrecoverable-error";
import { TerminationReason } from "../../termination-manager/types";

describe("CheckpointFailedError", () => {
  it("should create error with default message", () => {
    const error = new CheckpointFailedError();

    expect(error.name).toBe("CheckpointFailedError");
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
    const error = new CheckpointFailedError("Custom checkpoint error");

    expect(error.message).toBe(
      "[Unrecoverable Invocation] Custom checkpoint error",
    );
    expect(error.terminationReason).toBe(TerminationReason.CHECKPOINT_FAILED);
    expect(error.isUnrecoverable).toBe(true);
    expect(error.isUnrecoverableInvocation).toBe(true);
  });

  it("should create error with original error", () => {
    const originalError = new Error("Database connection failed");
    const error = new CheckpointFailedError("Checkpoint failed", originalError);

    expect(error.message).toBe("[Unrecoverable Invocation] Checkpoint failed");
    expect(error.originalError).toBe(originalError);
    expect(error.stack).toContain("Caused by:");
    expect(error.stack).toContain(originalError.stack);
  });

  it("should be detected by isUnrecoverableError", () => {
    const error = new CheckpointFailedError();
    expect(isUnrecoverableError(error)).toBe(true);
  });
});
