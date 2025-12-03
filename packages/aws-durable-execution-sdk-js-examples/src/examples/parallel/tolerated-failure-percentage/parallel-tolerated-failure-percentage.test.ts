import { handler } from "./parallel-tolerated-failure-percentage";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Parallel toleratedFailurePercentage",
  functionName: "parallel-tolerated-failure-percentage",
  handler,
  tests: (runner) => {
    it("should complete with acceptable failure percentage", async () => {
      const execution = await runner.run();

      // Log execution history and state for debugging
      console.log("=== EXECUTION DEBUG INFO ===");
      console.log("Execution status:", execution.getStatus());
      console.log(
        "History events:",
        JSON.stringify(execution.getHistoryEvents(), null, 2),
      );

      const result = execution.getResult() as any;
      console.log("Result:", JSON.stringify(result, null, 2));

      expect(result.failureCount).toBe(2);
      expect(result.successCount).toBe(3);
      expect(result.failurePercentage).toBe(40);
      expect(result.completionReason).toBe("ALL_COMPLETED");
      expect(result.totalCount).toBe(5);
    });
  },
});
