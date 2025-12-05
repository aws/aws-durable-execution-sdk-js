import { handler } from "./parallel-tolerated-failure-percentage";
import { createTests } from "../../../utils/test-helper";
import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  name: "Parallel toleratedFailurePercentage",
  functionName: "parallel-tolerated-failure-percentage",
  handler,
  tests: (runner) => {
    it("should complete with acceptable failure percentage", async () => {
      const execution = await runner.run();

      const result = execution.getResult() as any;

      // Assert overall results
      expect(result.failureCount).toBe(2);
      expect(result.successCount).toBe(3);
      expect(result.failurePercentage).toBe(40);
      expect(result.completionReason).toBe("ALL_COMPLETED");
      expect(result.totalCount).toBe(5);

      // Verify individual branch statuses
      [
        { name: "branch-1", status: OperationStatus.SUCCEEDED },
        { name: "branch-2", status: OperationStatus.FAILED },
        { name: "branch-3", status: OperationStatus.SUCCEEDED },
        { name: "branch-4", status: OperationStatus.FAILED },
        { name: "branch-5", status: OperationStatus.SUCCEEDED },
      ].forEach(({ name, status }) => {
        expect(runner.getOperation(name)?.getStatus()).toBe(status);
      });
    });
  },
});
