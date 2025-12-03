import { handler } from "./map-tolerated-failure-percentage";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Map toleratedFailurePercentage",
  functionName: "map-tolerated-failure-percentage",
  handler,
  tests: (runner) => {
    it("should complete with acceptable failure percentage", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      expect(result.failureCount).toBe(3);
      expect(result.successCount).toBe(7);
      expect(result.failurePercentage).toBe(30);
      expect(result.completionReason).toBe("ALL_COMPLETED");
      expect(result.totalCount).toBe(10);
    });
  },
});
