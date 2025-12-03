import { handler } from "./map-tolerated-failure-count";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Map toleratedFailureCount",
  functionName: "map-tolerated-failure-count",
  handler,
  tests: (runner) => {
    it("should complete when failure tolerance is reached", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      expect(result.failureCount).toBe(2);
      expect(result.successCount).toBe(3);
      expect(result.completionReason).toBe("ALL_COMPLETED");
      expect(result.hasFailure).toBe(true);
      expect(result.totalCount).toBe(5);
    });
  },
});
