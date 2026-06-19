import { handler } from "./map-large-scale";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should handle 50 items with 100KB each using map", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Verify the execution succeeded
      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(result.success).toBe(true);

      // Verify the expected number of items were processed (50 items)
      expect(result.summary.itemsProcessed).toBe(50);
      expect(result.summary.allItemsProcessed).toBe(true);

      // Verify data size expectations (~5MB total from 50 items × 100KB each)
      expect(result.summary.totalDataSizeMB).toBeGreaterThan(4); // Should be ~5MB
      expect(result.summary.totalDataSizeMB).toBeLessThan(6);
      expect(result.summary.totalDataSizeBytes).toBeGreaterThan(5000000); // ~5MB
      expect(result.summary.averageItemSize).toBeGreaterThan(100000); // ~100KB per item
      expect(result.summary.maxConcurrency).toBe(10);

      // The number of host re-invocations (InvocationCompleted events) is
      // non-deterministic for a large map (50 items x 100KB) under cloud
      // execution — it varies with checkpoint/suspend timing and load (seen
      // as 3 vs 4 across runners). Allow a small tolerance, matching the other
      // large/concurrent map tests, instead of pinning an exact count.
      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 2,
      });
    });
  },
});
