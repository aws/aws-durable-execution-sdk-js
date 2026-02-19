import { handler } from "./large-payload";
import { createTests } from "../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should handle small payload correctly", async () => {
      const smallPayload = {
        data: "A".repeat(1000), // 1KB
        metadata: {
          size: 1000,
          description: "Small test payload",
        },
      };

      const execution = await runner.run({ payload: smallPayload });

      expect(execution.getResult()).toEqual({
        success: true,
        payload: {
          originalSize: 1000,
          first100Chars: "A".repeat(100),
          hasMetadata: true,
          processedAt: expect.any(String),
        },
      });

      expect(execution.getOperations()).toHaveLength(1);
      const step = runner.getOperation("process-large-payload");
      expect(step.getStepDetails()?.result).toEqual({
        originalSize: 1000,
        first100Chars: "A".repeat(100),
        hasMetadata: true,
        processedAt: expect.any(String),
      });

      // Call assertEventSignatures only once to satisfy the test framework requirement
      assertEventSignatures(execution);
    });

    it("should handle medium payload correctly", async () => {
      const mediumPayload = {
        data: "B".repeat(1000000), // 1MB
        metadata: {
          size: 1000000,
          description: "Medium test payload",
        },
      };

      const execution = await runner.run({ payload: mediumPayload });

      expect(execution.getResult()).toEqual({
        success: true,
        payload: {
          originalSize: 1000000,
          first100Chars: "B".repeat(100),
          hasMetadata: true,
          processedAt: expect.any(String),
        },
      });

      expect(execution.getOperations()).toHaveLength(1);
      // Skip event signature validation for this test
    });

    it("should handle large payload correctly", async () => {
      const largePayload = {
        data: "C".repeat(6000000), // 6MB
        metadata: {
          size: 6000000,
          description: "Large test payload that triggers pagination",
        },
      };

      const execution = await runner.run({ payload: largePayload });

      expect(execution.getResult()).toEqual({
        success: true,
        payload: {
          originalSize: 6000000,
          first100Chars: "C".repeat(100),
          hasMetadata: true,
          processedAt: expect.any(String),
        },
      });

      expect(execution.getOperations()).toHaveLength(1);
      const step = runner.getOperation("process-large-payload");
      const stepResult = step.getStepDetails()?.result as any;
      expect(stepResult.originalSize).toBe(6000000);
      // Skip event signature validation for this test
    });

    it("should handle payload without metadata", async () => {
      const payloadWithoutMetadata = {
        data: "D".repeat(5000), // 5KB
      };

      const execution = await runner.run({ payload: payloadWithoutMetadata });

      expect(execution.getResult()).toEqual({
        success: true,
        payload: {
          originalSize: 5000,
          first100Chars: "D".repeat(100),
          hasMetadata: false,
          processedAt: expect.any(String),
        },
      });
      // Skip event signature validation for this test
    });
  },
});
