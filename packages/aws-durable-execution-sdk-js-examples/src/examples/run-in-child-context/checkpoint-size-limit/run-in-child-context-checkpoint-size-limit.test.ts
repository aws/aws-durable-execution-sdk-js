import { handler } from "./run-in-child-context-checkpoint-size-limit";
import { createTests } from "../../../utils/test-helper";

const CHECKPOINT_SIZE_LIMIT = 256 * 1024;

createTests({
  name: "run-in-child-context-checkpoint-size-limit boundary test",
  functionName: "run-in-child-context-checkpoint-size-limit",
  handler,
  tests: (runner) => {
    it("should handle 100 iterations near checkpoint size limit", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Verify the execution succeeded
      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(result.success).toBe(true);
      expect(result.totalIterations).toBe(100);

      // Verify checkpoint limit constant
      expect(result.checkpointLimit).toBe(CHECKPOINT_SIZE_LIMIT);

      // Analyze boundary behavior
      const underLimitResults = result.results.filter(
        (r: any) => !r.isOverLimit,
      );
      const overLimitResults = result.results.filter((r: any) => r.isOverLimit);

      // Verify all results have correct payload sizes
      result.results.forEach((r: any, index: number) => {
        const expectedSize = CHECKPOINT_SIZE_LIMIT - 10 + index;
        expect(r.payloadSize).toBe(expectedSize);
        expect(r.resultSize).toBe(expectedSize);
        expect(r.isOverLimit).toBe(expectedSize >= CHECKPOINT_SIZE_LIMIT);
        expect(r.serializedSize).toBeGreaterThan(r.payloadSize); // Should have serialization overhead
      });

      // Verify boundary conditions - now much tighter around the limit
      expect(underLimitResults.length).toBe(10); // Sizes LIMIT-10 to LIMIT-1
      expect(overLimitResults.length).toBe(90); // Sizes LIMIT to LIMIT+89
    }, 120000);
  },
});
