import { handler } from "./parallel-tolerated-failure-percentage";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Parallel toleratedFailurePercentage",
  functionName: "parallel-tolerated-failure-percentage",
  handler,
  tests: (runner) => {
    it("should complete with acceptable failure percentage", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      expect(result.failureCount).toBe(2);
      expect(result.successCount).toBe(3);
      expect(result.failurePercentage).toBe(40);
      expect(result.completionReason).toBe("ALL_COMPLETED");
      expect(result.totalCount).toBe(5);
    });
  },
});
