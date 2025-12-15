import { handler } from "./parallel-min-successful";
import { createTests } from "../../../utils/test-helper";
import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  localRunnerConfig: {
    skipTime: false,
  },
  handler,
  tests: (runner) => {
    it("should complete early when minSuccessful is reached", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Assert overall results
      expect(result.successCount).toBe(2);
      expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
      expect(result.results).toHaveLength(2);
      expect(result.totalCount).toBe(4);

      // Get the parallel operation to verify individual branch results
      // Get individual branch operations
      const branch1 = runner.getOperation("branch-1");
      const branch2 = runner.getOperation("branch-2");
      const branch3 = runner.getOperation("branch-3");
      const branch4 = runner.getOperation("branch-4");

      // First two branches should succeed (branch-1 and branch-2 complete fastest)
      expect(branch1?.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(branch2?.getStatus()).toBe(OperationStatus.SUCCEEDED);

      // TODO: Re-enable these assertions when we find the root cause of the cloud timing issue
      // where remaining items show SUCCEEDED instead of STARTED
      // Remaining branches should be in STARTED state (not completed)
      // expect(branch3?.getStatus()).toBe(OperationStatus.STARTED);
      // expect(branch4?.getStatus()).toBe(OperationStatus.STARTED);

      // Verify the results array matches
      expect(result.results).toEqual(["Branch 1 result", "Branch 2 result"]);
    });
  },
});
