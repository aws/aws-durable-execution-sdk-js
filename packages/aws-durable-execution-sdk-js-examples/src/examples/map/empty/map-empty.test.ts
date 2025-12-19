import { handler } from "./map-empty";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should execute successfully with empty map array and expected result structure", async () => {
      const execution = await runner.run();

      const result = execution.getResult() as any;

      expect(result).toBeDefined();
      expect(result.results).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
      expect(result.totalCount).toBe(0);
      expect(result.status).toBe("SUCCEEDED");
      expect(result.completionReason).toBe("ALL_COMPLETED");

      // Verify the map operation exists but has no child operations
      const emptyMap = runner.getOperation("empty-map");
      expect(emptyMap.getChildOperations()).toHaveLength(0);

      assertEventSignatures(execution);
    });
  },
});
