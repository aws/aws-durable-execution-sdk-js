import { handler } from "./parallel-failure-threshold-exceeded-count";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Parallel failure threshold exceeded count",
  functionName: "parallel-failure-threshold-exceeded-count",
  handler,
  tests: (runner) => {
    it("should return FAILURE_TOLERANCE_EXCEEDED when failure count exceeds threshold", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
      expect(result.successCount).toBe(2); // Tasks 4 and 5 succeed
      expect(result.failureCount).toBe(3); // Tasks 1, 2, 3 fail (exceeds threshold of 2)
      expect(result.totalCount).toBe(5);
    });
  },
});
