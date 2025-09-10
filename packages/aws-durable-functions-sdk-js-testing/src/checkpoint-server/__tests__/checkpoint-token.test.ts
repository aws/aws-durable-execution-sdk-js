import {
  CheckpointTokenData,
  decodeCheckpointToken,
  encodeCheckpointToken,
} from "../utils/checkpoint-token";
import {
  CheckpointToken,
  createExecutionId,
  createInvocationId,
} from "../utils/tagged-strings";
import { createCheckpointToken } from "../utils/tagged-strings";

describe("checkpoint-token", () => {
  describe("createCheckpointToken", () => {
    it("should return the same string as a checkpoint token type", () => {
      const input = "hello world";
      const result = createCheckpointToken(input) satisfies CheckpointToken;

      expect(result).toBe(input);
    });
  });

  describe("encodeCheckpointToken", () => {
    it("should encode CheckpointTokenData into a base64 string", () => {
      const tokenData: CheckpointTokenData = {
        executionId: createExecutionId("test-execution-id"),
        invocationId: createInvocationId("test-invocation-id"),
        token: "test-token",
      };

      const result = encodeCheckpointToken(tokenData);

      // Verify it's a base64 string
      expect(typeof result).toBe("string");
      // Verify it can be decoded as base64
      expect(() =>
        Buffer.from(result, "base64").toString("utf-8")
      ).not.toThrow();
      // Verify the content matches what we expect
      const decoded = JSON.parse(
        Buffer.from(result, "base64").toString("utf-8")
      ) as CheckpointTokenData;
      expect(decoded).toEqual(tokenData);
    });

    it("should handle empty token fields", () => {
      const tokenData: CheckpointTokenData = {
        executionId: createExecutionId(""),
        invocationId: createInvocationId(""),
        token: "",
      };

      const result = encodeCheckpointToken(tokenData);
      const decoded = JSON.parse(
        Buffer.from(result, "base64").toString("utf-8")
      ) as CheckpointTokenData;
      expect(decoded).toEqual(tokenData);
    });
  });

  describe("decodeCheckpointToken", () => {
    it("should decode a base64 string into CheckpointTokenData", () => {
      const tokenData: CheckpointTokenData = {
        executionId: createExecutionId("test-execution-id"),
        invocationId: createInvocationId("test-invocation-id"),
        token: "test-token",
      };
      const encodedToken = Buffer.from(JSON.stringify(tokenData)).toString(
        "base64"
      ) as CheckpointToken;

      const result = decodeCheckpointToken(encodedToken);

      expect(result).toEqual(tokenData);
    });

    it("should throw an error when trying to decode an invalid base64 string", () => {
      const invalidToken = "not-a-valid-base64-string" as CheckpointToken;

      expect(() => {
        decodeCheckpointToken(invalidToken);
      }).toThrow();
    });
    
    it("should wrap non-Error exceptions in an Error object", () => {
      // Mock Buffer.from to throw a string instead of an Error object
      const originalFrom = Buffer.from;
      Buffer.from = jest.fn().mockImplementation(() => {
        throw new Error("Test error");
      });
      
      const invalidToken = "invalid-token" as CheckpointToken;
      
      try {
        expect(() => {
          decodeCheckpointToken(invalidToken);
        }).toThrow(Error);
        
        // Also verify the error message
        expect(() => {
          decodeCheckpointToken(invalidToken);
        }).toThrow(/Failed to decode checkpoint token:/);
      } finally {
        // Restore original function
        Buffer.from = originalFrom;
      }
    });

    it("should throw an error when decoded data is not a valid CheckpointTokenData object", () => {
      // Create base64 string that doesn't contain valid CheckpointTokenData
      const invalidData = Buffer.from(JSON.stringify({ foo: "bar" })).toString(
        "base64"
      ) as CheckpointToken;

      expect(() => {
        decodeCheckpointToken(invalidData);
      }).toThrow();
    });
  });

  describe("encode and decode round trip", () => {
    it("should preserve all data through encode and decode operations", () => {
      const originalData: CheckpointTokenData = {
        executionId: createExecutionId("test-execution-id"),
        invocationId: createInvocationId("test-invocation-id"),
        token: "test-token",
      };

      const encodedToken = encodeCheckpointToken(originalData);
      const decodedData = decodeCheckpointToken(encodedToken);

      expect(decodedData).toEqual(originalData);
    });
  });
});
