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

      // Get individual branch operations
      const branch1 = runner.getOperation("branch-1");
      const branch2 = runner.getOperation("branch-2");
      const branch3 = runner.getOperation("branch-3");
      const branch4 = runner.getOperation("branch-4");
      const branch5 = runner.getOperation("branch-5");

      // Branch 1 should succeed
      expect(branch1?.getStatus()).toBe(OperationStatus.SUCCEEDED);

      // Branch 2 should fail
      expect(branch2?.getStatus()).toBe(OperationStatus.FAILED);

      // Branch 3 should succeed
      expect(branch3?.getStatus()).toBe(OperationStatus.SUCCEEDED);

      // Branch 4 should fail
      expect(branch4?.getStatus()).toBe(OperationStatus.FAILED);

      // Branch 5 should succeed
      expect(branch5?.getStatus()).toBe(OperationStatus.SUCCEEDED);
    });
  },
});
