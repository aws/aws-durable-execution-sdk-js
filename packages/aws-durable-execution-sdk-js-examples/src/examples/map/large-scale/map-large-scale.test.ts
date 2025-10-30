import { handler } from "./map-large-scale";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "map-large-scale test",
  functionName: "map-large-scale",
  handler,
  localRunnerConfig: {
    skipTime: true, // Skip wait delays for faster testing
  },
  tests: (runner) => {
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
    });
  },
});
