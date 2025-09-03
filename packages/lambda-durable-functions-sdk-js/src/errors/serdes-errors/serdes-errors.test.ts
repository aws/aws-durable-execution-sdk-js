import {
  SerializationFailedError,
  DeserializationFailedError,
  isSerdesError,
  safeSerialize,
  safeDeserialize,
} from "./serdes-errors";
import {
  UnrecoverableError,
  UnrecoverableExecutionError,
  isUnrecoverableError,
  isUnrecoverableExecutionError,
} from "../unrecoverable-error/unrecoverable-error";
import { TerminationReason } from "../../termination-manager/types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TEST_CONSTANTS } from "../../testing/test-constants";

describe("Serdes Errors", () => {
  describe("SerializationFailedError", () => {
    it("should create error with correct properties", () => {
      const originalError = new Error("JSON.stringify failed");
      const error = new SerializationFailedError(
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        originalError,
      );

      expect(error.name).toBe("SerializationFailedError");
      expect(error.message).toContain("[Unrecoverable Execution]");
      expect(error.message).toContain(
        'Serialization failed for step "test-step" (step-1)',
      );
      expect(error.message).toContain("JSON.stringify failed");
      expect(error.terminationReason).toBe(TerminationReason.CUSTOM);
      expect(error.isUnrecoverable).toBe(true);
      expect(error.isUnrecoverableExecution).toBe(true);
      expect(error.originalError).toBe(originalError);
      expect(error).toBeInstanceOf(UnrecoverableError);
      expect(error).toBeInstanceOf(UnrecoverableExecutionError);
    });

    it("should create error without step name", () => {
      const error = new SerializationFailedError("step-1");

      expect(error.message).toContain("Serialization failed for step (step-1)");
      expect(error.message).not.toContain('"');
    });

    it("should preserve original stack trace", () => {
      const originalError = new Error("Original error");
      const error = new SerializationFailedError(
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        originalError,
      );

      expect(error.stack).toContain("Caused by:");
      expect(error.stack).toContain(originalError.stack);
    });

    it("should create error without originalError", () => {
      const error = new SerializationFailedError("step-1", "test-step");

      expect(error.message).toContain("[Unrecoverable Execution]");
      expect(error.message).toContain(
        'Serialization failed for step "test-step" (step-1)',
      );
      expect(error.message).toContain("Unknown serialization error");
      expect(error.originalError).toBeUndefined();
    });

    it("should create error with originalError that has no message", () => {
      const originalError = new Error("");
      const error = new SerializationFailedError(
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        originalError,
      );

      expect(error.message).toContain("[Unrecoverable Execution]");
      expect(error.message).toContain(
        'Serialization failed for step "test-step" (step-1)',
      );
      expect(error.message).toContain("Unknown serialization error");
      expect(error.originalError).toBe(originalError);
    });
  });

  describe("DeserializationFailedError", () => {
    it("should create error with correct properties", () => {
      const originalError = new Error("JSON.parse failed");
      const error = new DeserializationFailedError(
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        originalError,
      );

      expect(error.name).toBe("DeserializationFailedError");
      expect(error.message).toContain("[Unrecoverable Execution]");
      expect(error.message).toContain(
        'Deserialization failed for step "test-step" (step-1)',
      );
      expect(error.message).toContain("JSON.parse failed");
      expect(error.terminationReason).toBe(TerminationReason.CUSTOM);
      expect(error.isUnrecoverable).toBe(true);
      expect(error.isUnrecoverableExecution).toBe(true);
      expect(error.originalError).toBe(originalError);
      expect(error).toBeInstanceOf(UnrecoverableError);
      expect(error).toBeInstanceOf(UnrecoverableExecutionError);
    });

    it("should create error without step name", () => {
      const error = new DeserializationFailedError("step-1");

      expect(error.message).toContain(
        "Deserialization failed for step (step-1)",
      );
      expect(error.message).not.toContain('"');
    });

    it("should create error without originalError", () => {
      const error = new DeserializationFailedError("step-1", "test-step");

      expect(error.message).toContain("[Unrecoverable Execution]");
      expect(error.message).toContain(
        'Deserialization failed for step "test-step" (step-1)',
      );
      expect(error.message).toContain("Unknown deserialization error");
      expect(error.originalError).toBeUndefined();
    });

    it("should create error with originalError that has no message", () => {
      const originalError = new Error("");
      const error = new DeserializationFailedError(
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        originalError,
      );

      expect(error.message).toContain("[Unrecoverable Execution]");
      expect(error.message).toContain(
        'Deserialization failed for step "test-step" (step-1)',
      );
      expect(error.message).toContain("Unknown deserialization error");
      expect(error.originalError).toBe(originalError);
    });
  });

  describe("isSerdesError", () => {
    it("should return true for SerializationFailedError", () => {
      const error = new SerializationFailedError("step-1");
      expect(isSerdesError(error)).toBe(true);
    });

    it("should return true for DeserializationFailedError", () => {
      const error = new DeserializationFailedError("step-1");
      expect(isSerdesError(error)).toBe(true);
    });

    it("should return false for regular Error", () => {
      const error = new Error("Regular error");
      expect(isSerdesError(error)).toBe(false);
    });

    it("should return false for non-Error objects", () => {
      expect(isSerdesError("string")).toBe(false);
      expect(isSerdesError(null)).toBe(false);
      expect(isSerdesError(undefined)).toBe(false);
      expect(isSerdesError({})).toBe(false);
    });
  });

  describe("isUnrecoverableError integration", () => {
    it("should return true for SerializationFailedError", () => {
      const error = new SerializationFailedError("step-1");
      expect(isUnrecoverableError(error)).toBe(true);
      expect(isUnrecoverableExecutionError(error)).toBe(true);
    });

    it("should return true for DeserializationFailedError", () => {
      const error = new DeserializationFailedError("step-1");
      expect(isUnrecoverableError(error)).toBe(true);
      expect(isUnrecoverableExecutionError(error)).toBe(true);
    });
  });

  describe("safeSerialize", () => {
    const mockSerdes = {
      serialize: jest.fn(),
      deserialize: jest.fn(),
    };
    let mockTerminationManager: jest.Mocked<TerminationManager>;

    beforeEach(() => {
      mockTerminationManager = {
        terminate: jest.fn(),
        getTerminationPromise: jest.fn(),
      } as unknown as jest.Mocked<TerminationManager>;

      jest.clearAllMocks();
    });

    it("should return serialized value when successful", async () => {
      const value = { test: "data" };
      const serialized = '{"test":"data"}';
      mockSerdes.serialize.mockReturnValue(serialized);

      const result = await safeSerialize(
        mockSerdes,
        value,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        false,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      expect(result).toBe(serialized);
      expect(mockSerdes.serialize).toHaveBeenCalledWith(value, {
        entityId: TEST_CONSTANTS.STEP_ID_1,
        durableExecutionArn: TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      });
    });

    it("should use default isVerbose parameter", async () => {
      const value = { test: "data" };
      const serialized = '{"test":"data"}';
      mockSerdes.serialize.mockReturnValue(serialized);

      const result = await safeSerialize(
        mockSerdes,
        value,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        undefined,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      expect(result).toBe(serialized);
    });

    it("should call terminate when serialization fails", async () => {
      const value = { test: "data" };
      const originalError = new Error("Circular reference");
      mockSerdes.serialize.mockImplementation(() => {
        throw originalError;
      });

      // Call safeSerialize but don't await it (it will never resolve due to termination)
      const resultPromise = safeSerialize(
        mockSerdes,
        value,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        false,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          'Serialization failed for step "test-step" (step-1): Circular reference',
      });
    }, 10000);

    it("should handle non-Error exceptions", async () => {
      const value = { test: "data" };
      mockSerdes.serialize.mockImplementation(() => {
        throw "String error";
      });

      // Call safeSerialize but don't await it (it will never resolve due to termination)
      const resultPromise = safeSerialize(
        mockSerdes,
        value,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        false,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          'Serialization failed for step "test-step" (step-1): Unknown serialization error',
      });
    }, 10000);

    it("should handle non-Error exceptions without step name", async () => {
      const value = { test: "data" };
      mockSerdes.serialize.mockImplementation(() => {
        throw "String error";
      });

      // Call safeSerialize but don't await it (it will never resolve due to termination)
      const resultPromise = safeSerialize(
        mockSerdes,
        value,
        TEST_CONSTANTS.STEP_ID_1,
        undefined,
        mockTerminationManager,
        false,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          "Serialization failed for step (step-1): Unknown serialization error",
      });
    }, 10000);

    it("should call terminate when async serialization fails with Error", async () => {
      const value = { test: "data" };
      const originalError = new Error("Async serialization failed");
      mockSerdes.serialize.mockRejectedValue(originalError);

      // Call safeSerialize but don't await it (it will never resolve due to termination)
      const resultPromise = safeSerialize(
        mockSerdes,
        value,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        false,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          'Serialization failed for step "test-step" (step-1): Async serialization failed',
      });
    }, 10000);

    it("should handle async non-Error exceptions", async () => {
      const value = { test: "data" };
      mockSerdes.serialize.mockRejectedValue("Async string error");

      // Call safeSerialize but don't await it (it will never resolve due to termination)
      const resultPromise = safeSerialize(
        mockSerdes,
        value,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        false,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          'Serialization failed for step "test-step" (step-1): Unknown serialization error',
      });
    }, 10000);

    it("should handle async non-Error exceptions without step name", async () => {
      const value = { test: "data" };
      mockSerdes.serialize.mockRejectedValue("Async string error");

      // Call safeSerialize but don't await it (it will never resolve due to termination)
      const resultPromise = safeSerialize(
        mockSerdes,
        value,
        TEST_CONSTANTS.STEP_ID_1,
        undefined,
        mockTerminationManager,
        false,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          "Serialization failed for step (step-1): Unknown serialization error",
      });
    }, 10000);
  });

  describe("safeDeserialize", () => {
    const mockSerdes = {
      serialize: jest.fn(),
      deserialize: jest.fn(),
    };
    let mockTerminationManager: jest.Mocked<TerminationManager>;

    beforeEach(() => {
      mockTerminationManager = {
        terminate: jest.fn(),
        getTerminationPromise: jest.fn(),
      } as unknown as jest.Mocked<TerminationManager>;

      jest.clearAllMocks();
    });

    it("should return deserialized value when successful", async () => {
      const data = '{"test":"data"}';
      const deserialized = { test: "data" };
      mockSerdes.deserialize.mockReturnValue(deserialized);

      const result = await safeDeserialize(
        mockSerdes,
        data,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        false,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      expect(result).toBe(deserialized);
      expect(mockSerdes.deserialize).toHaveBeenCalledWith(data, {
        entityId: TEST_CONSTANTS.STEP_ID_1,
        durableExecutionArn: TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      });
    });

    it("should use default isVerbose parameter", async () => {
      const data = '{"test":"data"}';
      const deserialized = { test: "data" };
      mockSerdes.deserialize.mockReturnValue(deserialized);

      const result = await safeDeserialize(
        mockSerdes,
        data,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        undefined,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      expect(result).toBe(deserialized);
    });

    it("should call terminate when deserialization fails", async () => {
      const data = "invalid json";
      const originalError = new Error("Unexpected token");
      mockSerdes.deserialize.mockImplementation(() => {
        throw originalError;
      });

      // Call safeDeserialize but don't await it (it will never resolve due to termination)
      const resultPromise = safeDeserialize(
        mockSerdes,
        data,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        false,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          'Deserialization failed for step "test-step" (step-1): Unexpected token',
      });
    }, 10000);

    it("should handle non-Error exceptions", async () => {
      const data = "invalid json";
      mockSerdes.deserialize.mockImplementation(() => {
        throw "String error";
      });

      // Call safeDeserialize but don't await it (it will never resolve due to termination)
      const resultPromise = safeDeserialize(
        mockSerdes,
        data,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        false,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          'Deserialization failed for step "test-step" (step-1): Unknown deserialization error',
      });
    }, 10000);

    it("should handle non-Error exceptions without step name", async () => {
      const data = "invalid json";
      mockSerdes.deserialize.mockImplementation(() => {
        throw "String error";
      });

      // Call safeDeserialize but don't await it (it will never resolve due to termination)
      const resultPromise = safeDeserialize(
        mockSerdes,
        data,
        TEST_CONSTANTS.STEP_ID_1,
        undefined,
        mockTerminationManager,
        false,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          "Deserialization failed for step (step-1): Unknown deserialization error",
      });
    }, 10000);

    it("should call terminate when async deserialization fails with Error", async () => {
      const data = "invalid json";
      const originalError = new Error("Async deserialization failed");
      mockSerdes.deserialize.mockRejectedValue(originalError);

      // Call safeDeserialize but don't await it (it will never resolve due to termination)
      const resultPromise = safeDeserialize(
        mockSerdes,
        data,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        false,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          'Deserialization failed for step "test-step" (step-1): Async deserialization failed',
      });
    }, 10000);

    it("should handle async non-Error exceptions", async () => {
      const data = "invalid json";
      mockSerdes.deserialize.mockRejectedValue("Async string error");

      // Call safeDeserialize but don't await it (it will never resolve due to termination)
      const resultPromise = safeDeserialize(
        mockSerdes,
        data,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        false,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          'Deserialization failed for step "test-step" (step-1): Unknown deserialization error',
      });
    }, 10000);

    it("should handle async non-Error exceptions without step name", async () => {
      const data = "invalid json";
      mockSerdes.deserialize.mockRejectedValue("Async string error");

      // Call safeDeserialize but don't await it (it will never resolve due to termination)
      const resultPromise = safeDeserialize(
        mockSerdes,
        data,
        TEST_CONSTANTS.STEP_ID_1,
        undefined,
        mockTerminationManager,
        false,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message:
          "Deserialization failed for step (step-1): Unknown deserialization error",
      });
    }, 10000);
  });
});
