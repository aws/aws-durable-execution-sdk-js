import { handler } from "./map-failure-threshold-exceeded-percentage";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Map failure threshold exceeded percentage",
  functionName: "map-failure-threshold-exceeded-percentage",
  handler,
  tests: (runner) => {
    it("should return FAILURE_TOLERANCE_EXCEEDED when failure percentage exceeds threshold", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
      expect(result.successCount).toBe(2); // Items 4 and 5 succeed
      expect(result.failureCount).toBe(3); // Items 1, 2, 3 fail (60% > 50% threshold)
      expect(result.totalCount).toBe(5);
    });
  },
});
