import { vi, describe, it, expect, beforeEach, type Mocked } from "vitest";
import { terminateForUnrecoverableError } from "./termination-helper";
import { ExecutionContext } from "../../types";
import { TerminationReason } from "../../termination-manager/types";
import { UnrecoverableError } from "../../errors/unrecoverable-error/unrecoverable-error";

// Create concrete implementation for testing
class TestUnrecoverableError extends UnrecoverableError {
  readonly terminationReason = TerminationReason.CUSTOM;

  constructor(message: string, originalError?: Error) {
    super(message, originalError);
  }
}

describe("terminateForUnrecoverableError", () => {
  let mockContext: Mocked<ExecutionContext>;

  beforeEach(() => {
    mockContext = {
      terminationManager: {
        terminate: vi.fn(),
      },
    } as any;
  });

  it("should terminate immediately with unrecoverable error", () => {
    const error = new TestUnrecoverableError("Test error");

    terminateForUnrecoverableError(mockContext, error, "test-step");

    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.CUSTOM,
      message: "Unrecoverable error in step test-step: Test error",
      error,
    });
  });

  it("should return never-resolving promise", () => {
    const error = new TestUnrecoverableError("Test error");

    const promise = terminateForUnrecoverableError(
      mockContext,
      error,
      "test-step",
    );

    expect(promise).toBeInstanceOf(Promise);
    // Promise should never resolve
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    setTimeout(() => {
      expect(resolved).toBe(false);
    }, 100);
  });
});
