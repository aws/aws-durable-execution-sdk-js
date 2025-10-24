import {
  safeSerialize,
  safeDeserialize,
  SerdesFailedError,
} from "./serdes-errors";
import { TerminationReason } from "../../termination-manager/types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TEST_CONSTANTS } from "../../testing/test-constants";

describe("Serdes Errors", () => {
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
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      expect(result).toBe(serialized);
      expect(mockSerdes.serialize).toHaveBeenCalledWith(value, {
        entityId: TEST_CONSTANTS.STEP_ID_1,
        durableExecutionArn: TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      });
    });

    it("should call terminate when serialization fails", async () => {
      const value = { test: "data" };
      const originalError = new Error("Circular reference");
      mockSerdes.serialize.mockImplementation(() => {
        throw originalError;
      });

      // Call safeSerialize but don't await it (it will never resolve due to termination)
      safeSerialize(
        mockSerdes,
        value,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
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
      safeSerialize(
        mockSerdes,
        value,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
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
      safeSerialize(
        mockSerdes,
        value,
        TEST_CONSTANTS.STEP_ID_1,
        undefined,
        mockTerminationManager,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
        message:
          "Serialization failed for step (step-1): Unknown serialization error",
      });
    }, 10000);

    it("should call terminate when async serialization fails with Error", async () => {
      const value = { test: "data" };
      const originalError = new Error("Async serialization failed");
      mockSerdes.serialize.mockRejectedValue(originalError);

      // Call safeSerialize but don't await it (it will never resolve due to termination)
      safeSerialize(
        mockSerdes,
        value,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
        message:
          'Serialization failed for step "test-step" (step-1): Async serialization failed',
      });
    }, 10000);

    it("should handle async non-Error exceptions", async () => {
      const value = { test: "data" };
      mockSerdes.serialize.mockRejectedValue("Async string error");

      // Call safeSerialize but don't await it (it will never resolve due to termination)
      safeSerialize(
        mockSerdes,
        value,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
        message:
          'Serialization failed for step "test-step" (step-1): Unknown serialization error',
      });
    }, 10000);

    it("should handle async non-Error exceptions without step name", async () => {
      const value = { test: "data" };
      mockSerdes.serialize.mockRejectedValue("Async string error");

      // Call safeSerialize but don't await it (it will never resolve due to termination)
      safeSerialize(
        mockSerdes,
        value,
        TEST_CONSTANTS.STEP_ID_1,
        undefined,
        mockTerminationManager,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
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
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      expect(result).toBe(deserialized);
      expect(mockSerdes.deserialize).toHaveBeenCalledWith(data, {
        entityId: TEST_CONSTANTS.STEP_ID_1,
        durableExecutionArn: TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      });
    });

    it("should call terminate when deserialization fails", async () => {
      const data = "invalid json";
      const originalError = new Error("Unexpected token");
      mockSerdes.deserialize.mockImplementation(() => {
        throw originalError;
      });

      // Call safeDeserialize but don't await it (it will never resolve due to termination)
      safeDeserialize(
        mockSerdes,
        data,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
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
      safeDeserialize(
        mockSerdes,
        data,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
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
      safeDeserialize(
        mockSerdes,
        data,
        TEST_CONSTANTS.STEP_ID_1,
        undefined,
        mockTerminationManager,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
        message:
          "Deserialization failed for step (step-1): Unknown deserialization error",
      });
    }, 10000);

    it("should call terminate when async deserialization fails with Error", async () => {
      const data = "invalid json";
      const originalError = new Error("Async deserialization failed");
      mockSerdes.deserialize.mockRejectedValue(originalError);

      // Call safeDeserialize but don't await it (it will never resolve due to termination)
      safeDeserialize(
        mockSerdes,
        data,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
        message:
          'Deserialization failed for step "test-step" (step-1): Async deserialization failed',
      });
    }, 10000);

    it("should handle async non-Error exceptions", async () => {
      const data = "invalid json";
      mockSerdes.deserialize.mockRejectedValue("Async string error");

      // Call safeDeserialize but don't await it (it will never resolve due to termination)
      safeDeserialize(
        mockSerdes,
        data,
        TEST_CONSTANTS.STEP_ID_1,
        TEST_CONSTANTS.STEP_NAME,
        mockTerminationManager,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
        message:
          'Deserialization failed for step "test-step" (step-1): Unknown deserialization error',
      });
    }, 10000);

    it("should handle async non-Error exceptions without step name", async () => {
      const data = "invalid json";
      mockSerdes.deserialize.mockRejectedValue("Async string error");

      // Call safeDeserialize but don't await it (it will never resolve due to termination)
      safeDeserialize(
        mockSerdes,
        data,
        TEST_CONSTANTS.STEP_ID_1,
        undefined,
        mockTerminationManager,
        TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
      );

      // Wait a small amount of time for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify termination was called
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.SERDES_FAILED,
        message:
          "Deserialization failed for step (step-1): Unknown deserialization error",
      });
    }, 10000);
  });

  describe("SerdesFailedError", () => {
    it("should create error with custom message", () => {
      const error = new SerdesFailedError("Custom serdes error");

      expect(error.message).toContain("Custom serdes error");
      expect(error.terminationReason).toBe(TerminationReason.SERDES_FAILED);
    });

    it("should create error with default message", () => {
      const error = new SerdesFailedError();

      expect(error.message).toContain("Serdes operation failed");
      expect(error.terminationReason).toBe(TerminationReason.SERDES_FAILED);
    });

    it("should create error with original error", () => {
      const originalError = new Error("Original error");
      const error = new SerdesFailedError("Custom message", originalError);

      expect(error.message).toContain("Custom message");
      expect(error.originalError).toBe(originalError);
    });
  });
});
