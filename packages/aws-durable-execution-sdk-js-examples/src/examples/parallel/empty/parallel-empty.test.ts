import { handler } from "./parallel-empty";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should execute successfully with empty parallel array and expected result structure", async () => {
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

      // Verify the parallel operation exists but has no child operations
      const parallelOp = runner.getOperation("empty-parallel");
      expect(parallelOp.getChildOperations()).toHaveLength(0);

      assertEventSignatures(execution);
    });
  },
});
