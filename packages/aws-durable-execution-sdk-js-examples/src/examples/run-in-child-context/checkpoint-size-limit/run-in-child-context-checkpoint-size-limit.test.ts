import { handler } from "./run-in-child-context-checkpoint-size-limit";
import { createTests } from "../../../utils/test-helper";

const CHECKPOINT_SIZE_LIMIT = 256 * 1024;

createTests({
  name: "run-in-child-context-checkpoint-size-limit boundary test",
  functionName: "run-in-child-context-checkpoint-size-limit",
  handler,
  tests: (runner) => {
    it("should handle 200 iterations near checkpoint size limit", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Verify the execution succeeded
      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(result.success).toBe(true);
      expect(result.totalIterations).toBe(200);

      // Verify checkpoint limit constant
      expect(result.checkpointLimit).toBe(CHECKPOINT_SIZE_LIMIT);

      // Analyze boundary behavior
      const underLimitResults = result.results.filter(
        (r: any) => !r.isOverLimit,
      );
      const overLimitResults = result.results.filter((r: any) => r.isOverLimit);

      console.log(`\n=== CHECKPOINT SIZE BOUNDARY TEST RESULTS ===`);
      console.log(
        `Checkpoint size limit: ${CHECKPOINT_SIZE_LIMIT} bytes (256KB)`,
      );
      console.log(`Total iterations: ${result.totalIterations}`);
      console.log(`Under limit iterations: ${underLimitResults.length}`);
      console.log(`Over limit iterations: ${overLimitResults.length}`);
      console.log(
        `Payload size range: ${CHECKPOINT_SIZE_LIMIT - 10} to ${CHECKPOINT_SIZE_LIMIT + 189} bytes`,
      );

      // Show serialization overhead for first few results
      console.log(`\n=== SERIALIZATION OVERHEAD ANALYSIS ===`);
      result.results.slice(0, 5).forEach((r: any) => {
        console.log(
          `Payload: ${r.payloadSize} bytes, Serialized: ${r.serializedSize} bytes, Overhead: ${r.serializedSize - r.payloadSize} bytes`,
        );
      });

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
      expect(overLimitResults.length).toBe(190); // Sizes LIMIT to LIMIT+189
    }, 60000);
  },
});
