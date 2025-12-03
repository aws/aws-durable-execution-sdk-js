import { terminateForUnrecoverableError } from "./termination-helper";
import { ExecutionContext } from "../../types";
import { UnrecoverableError } from "../../errors/unrecoverable-error/unrecoverable-error";
import { TerminationReason } from "../../termination-manager/types";

// Create concrete implementation for testing
class TestUnrecoverableError extends UnrecoverableError {
  readonly terminationReason = TerminationReason.CUSTOM;

  constructor(message: string, originalError?: Error) {
    super(message, originalError);
  }
}

describe("termination helpers", () => {
  let mockContext: jest.Mocked<ExecutionContext>;

  beforeEach(() => {
    mockContext = {
      terminationManager: {
        terminate: jest.fn(),
      },
    } as any;
  });

  describe("terminateForUnrecoverableError", () => {
    it("should terminate execution with correct parameters for unrecoverable error", () => {
      const mockError = new TestUnrecoverableError("Test unrecoverable error");
      const stepIdentifier = "test-step";

      terminateForUnrecoverableError(mockContext, mockError, stepIdentifier);

      expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          "Unrecoverable error in step test-step: Test unrecoverable error",
      });
    });

    it("should return a never-resolving promise", () => {
      const mockError = new TestUnrecoverableError("Test error");
      const stepIdentifier = "test-step";

      const promise = terminateForUnrecoverableError(
        mockContext,
        mockError,
        stepIdentifier,
      );

      expect(promise).toBeInstanceOf(Promise);
    });
  });
});
