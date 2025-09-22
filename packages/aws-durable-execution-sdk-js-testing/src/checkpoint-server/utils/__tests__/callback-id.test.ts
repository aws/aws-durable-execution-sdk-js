import { encodeCallbackId, decodeCallbackId } from "../callback-id";
import { createCallbackId, createExecutionId } from "../tagged-strings";

describe("callback-id", () => {
  describe("encodeCallbackId", () => {
    it("should encode callback ID data correctly", () => {
      const data = {
        executionId: createExecutionId("test-execution-id"),
        operationId: "test-operation-id",
        token: "test-token",
      };

      const encoded = encodeCallbackId(data);
      expect(typeof encoded).toBe("string");
      expect(encoded.length).toBeGreaterThan(0);
    });
  });

  describe("decodeCallbackId", () => {
    it("should decode valid callback ID correctly", () => {
      const inputData = {
        executionId: createExecutionId("test-execution-id"),
        operationId: "test-operation-id",
      };

      const encoded = encodeCallbackId(inputData);
      const decoded = decodeCallbackId(encoded);

      expect(decoded.executionId).toBe(inputData.executionId);
      expect(decoded.operationId).toBe(inputData.operationId);
      expect(typeof decoded.token).toBe("string");
      expect(decoded.token).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    });

    it("should throw error for invalid JSON", () => {
      const invalidJson = Buffer.from("not-json", "utf-8").toString("base64");

      expect(() => decodeCallbackId(createCallbackId(invalidJson))).toThrow(
        "Failed to decode CallbackIdData"
      );
    });

    it("should throw error for missing executionId", () => {
      const incompleteData = {
        operationId: "test-operation-id",
        token: "test-token",
      };
      const encoded = Buffer.from(
        JSON.stringify(incompleteData),
        "utf-8"
      ).toString("base64");

      expect(() => decodeCallbackId(createCallbackId(encoded))).toThrow(
        "Failed to decode CallbackIdData"
      );
    });

    it("should throw error for missing operationId", () => {
      const incompleteData = {
        executionId: "test-execution-id",
        token: "test-token",
      };
      const encoded = Buffer.from(
        JSON.stringify(incompleteData),
        "utf-8"
      ).toString("base64");

      expect(() => decodeCallbackId(createCallbackId(encoded))).toThrow(
        "Failed to decode CallbackIdData"
      );
    });

    it("should throw error for missing token", () => {
      const incompleteData = {
        executionId: "test-execution-id",
        operationId: "test-operation-id",
      };
      const encoded = Buffer.from(
        JSON.stringify(incompleteData),
        "utf-8"
      ).toString("base64");

      expect(() => decodeCallbackId(createCallbackId(encoded))).toThrow(
        "Failed to decode CallbackIdData"
      );
    });
  });
});
