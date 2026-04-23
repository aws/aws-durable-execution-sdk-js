import { createTestCheckpointManager } from "../../testing/create-test-checkpoint-manager";
import { CheckpointManager } from "./checkpoint-manager";
import {
  CheckpointUnrecoverableInvocationError,
  CheckpointUnrecoverableExecutionError,
} from "../../errors/checkpoint-errors/checkpoint-errors";
import { DurableLogger, ExecutionContext } from "../../types";
import { EventEmitter } from "events";
import { createDefaultLogger } from "../logger/default-logger";

describe("Checkpoint Error Classification", () => {
  let handler: CheckpointManager;
  let mockContext: ExecutionContext;
  let mockLogger: DurableLogger;

  beforeEach(() => {
    mockContext = {
      _stepData: {},
      durableExecutionArn: "arn:test",
      state: {
        checkpoint: jest.fn(),
        getStepData: jest.fn(),
      },
      terminationManager: {
        terminate: jest.fn(),
        getTerminationPromise: jest.fn(),
      },
    } as any;
    mockLogger = createDefaultLogger(mockContext);

    const emitter = new EventEmitter();
    handler = createTestCheckpointManager(
      mockContext,
      "test-token",
      emitter,
      mockLogger,
    );
  });

  it("should classify 4xx InvalidParameterValueException with Invalid Checkpoint Token as invocation error", () => {
    const awsError = {
      name: "InvalidParameterValueException",
      message: "Invalid Checkpoint Token: token expired",
      $metadata: { httpStatusCode: 400 },
    };

    const result = (handler as any).classifyCheckpointError(awsError);

    expect(result).toBeInstanceOf(CheckpointUnrecoverableInvocationError);
    expect(result.message).toContain("Invalid Checkpoint Token");
  });

  it("should classify other 4xx errors as execution error", () => {
    const awsError = {
      name: "ValidationException",
      message: "Invalid parameter value",
      $metadata: { httpStatusCode: 400 },
    };

    const result = (handler as any).classifyCheckpointError(awsError);

    expect(result).toBeInstanceOf(CheckpointUnrecoverableExecutionError);
    expect(result.message).toContain("Invalid parameter value");
  });

  it("should classify 429 errors as invocation error (retryable)", () => {
    const awsError = {
      name: "TooManyRequestsException",
      message: "Rate limit exceeded",
      $metadata: { httpStatusCode: 429 },
    };

    const result = (handler as any).classifyCheckpointError(awsError);

    expect(result).toBeInstanceOf(CheckpointUnrecoverableInvocationError);
    expect(result.message).toContain("Rate limit exceeded");
  });

  it("should classify 4xx InvalidParameterValueException without Invalid Checkpoint Token as execution error", () => {
    const awsError = {
      name: "InvalidParameterValueException",
      message: "Some other invalid parameter",
      $metadata: { httpStatusCode: 400 },
    };

    const result = (handler as any).classifyCheckpointError(awsError);

    expect(result).toBeInstanceOf(CheckpointUnrecoverableExecutionError);
    expect(result.message).toContain("Some other invalid parameter");
  });

  it("should classify 5xx errors as invocation error", () => {
    const awsError = {
      name: "InternalServerError",
      message: "Service unavailable",
      $metadata: { httpStatusCode: 500 },
    };

    const result = (handler as any).classifyCheckpointError(awsError);

    expect(result).toBeInstanceOf(CheckpointUnrecoverableInvocationError);
    expect(result.message).toContain("Service unavailable");
  });

  it("should classify unknown errors as invocation error", () => {
    const unknownError = new Error("Network timeout");

    const result = (handler as any).classifyCheckpointError(unknownError);

    expect(result).toBeInstanceOf(CheckpointUnrecoverableInvocationError);
    expect(result.message).toContain("Network timeout");
  });

  it("should classify KMSAccessDeniedException as execution error", () => {
    const awsError = {
      name: "KMSAccessDeniedException",
      message:
        "Lambda was unable to decrypt the environment variables because KMS access was denied.",
      $metadata: { httpStatusCode: 502 },
    };

    const result = (handler as any).classifyCheckpointError(awsError);

    expect(result).toBeInstanceOf(CheckpointUnrecoverableExecutionError);
    expect(result.message).toContain("KMS access was denied");
  });

  it("should classify KMSDisabledException as execution error", () => {
    const awsError = {
      name: "KMSDisabledException",
      message:
        "Lambda was unable to decrypt the environment variables because the KMS key used is disabled.",
      $metadata: { httpStatusCode: 502 },
    };

    const result = (handler as any).classifyCheckpointError(awsError);

    expect(result).toBeInstanceOf(CheckpointUnrecoverableExecutionError);
  });

  it("should classify KMSInvalidStateException as execution error", () => {
    const awsError = {
      name: "KMSInvalidStateException",
      message: "KMS key state is not valid for Decrypt.",
      $metadata: { httpStatusCode: 502 },
    };

    const result = (handler as any).classifyCheckpointError(awsError);

    expect(result).toBeInstanceOf(CheckpointUnrecoverableExecutionError);
  });

  it("should classify KMSNotFoundException as execution error", () => {
    const awsError = {
      name: "KMSNotFoundException",
      message: "KMS key was not found.",
      $metadata: { httpStatusCode: 502 },
    };

    const result = (handler as any).classifyCheckpointError(awsError);

    expect(result).toBeInstanceOf(CheckpointUnrecoverableExecutionError);
  });

  it("should classify 502 without KMS error name as invocation error", () => {
    const awsError = {
      name: "ServiceException",
      message: "Service unavailable",
      $metadata: { httpStatusCode: 502 },
    };

    const result = (handler as any).classifyCheckpointError(awsError);

    expect(result).toBeInstanceOf(CheckpointUnrecoverableInvocationError);
    expect(result.message).toContain("Service unavailable");
  });

  it("should preserve original error in classified error", () => {
    const originalError = new Error("Original error");
    const result = (handler as any).classifyCheckpointError(originalError);

    expect(result.originalError).toBe(originalError);
  });
});
