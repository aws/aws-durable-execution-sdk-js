import { hashId, getStepData } from "./step-id-utils";
import { TEST_CONSTANTS } from "../../testing/test-constants";

describe("Hash Utility", () => {
  describe("hashId", () => {
    it("should create consistent hash for same input", () => {
      const input = TEST_CONSTANTS.STEP_ID;
      const hash1 = hashId(input);
      const hash2 = hashId(input);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(16); // Truncated hash length
    });

    it("should create different hashes for different inputs", () => {
      const hash1 = hashId("step-1");
      const hash2 = hashId("step-2");

      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty string", () => {
      const hash = hashId("");
      expect(hash).toHaveLength(16);
    });
  });

  describe("getStepData", () => {
    it("should retrieve data using original stepId", () => {
      const stepId = TEST_CONSTANTS.STEP;
      const hashedId = hashId(stepId);
      const mockData = { Status: "SUCCEEDED", Result: TEST_CONSTANTS.RESULT };

      const stepData = {
        [hashedId]: mockData,
      };

      const result = getStepData(stepData, stepId);
      expect(result).toBe(mockData);
    });

    it("should return undefined for non-existent stepId", () => {
      const stepData = {};
      const result = getStepData(stepData, "non-existent");
      expect(result).toBeUndefined();
    });

    it("should work with complex step data", () => {
      const stepId = "complex-step";
      const hashedId = hashId(stepId);
      const mockOperation = {
        Id: hashedId,
        Status: "SUCCEEDED",
        StepDetails: {
          Result: "complex-result",
        },
      };

      const stepData = {
        [hashedId]: mockOperation,
      };

      const result = getStepData(stepData, stepId);
      expect(result).toBe(mockOperation);
      expect(result.StepDetails?.Result).toBe("complex-result");
    });
  });
});
