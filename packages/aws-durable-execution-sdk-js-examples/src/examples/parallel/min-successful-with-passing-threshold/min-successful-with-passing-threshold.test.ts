import { handler } from "./min-successful-with-passing-threshold";
import { createTests } from "../../../utils/test-helper";
import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  localRunnerConfig: {
    skipTime: false,
    checkpointDelay: 100,
  },
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should complete early when minSuccessful is reached", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Assert overall results
      expect(result.successCount).toBe(2);
      expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
      expect(result.totalCount).toBe(5);

      // Get the parallel operation to verify individual branch results
      // Get individual branch operations
      const branch1 = runner.getOperation("branch-1");
      const branch2 = runner.getOperation("branch-2");
      const branch3 = runner.getOperation("branch-3");
      const branch4 = runner.getOperation("branch-4");
      const branch5 = runner.getOperation("branch-5");

      // First two branches should succeed (branch-1 and branch-2 complete fastest)
      expect(branch1?.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(branch2?.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(branch3?.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(branch4?.getStatus()).toBe(OperationStatus.SUCCEEDED);

      // Remaining branches should be in STARTED state (not completed)
      expect(branch5?.getStatus()).toBe(OperationStatus.STARTED);

      // Verify the results array matches
      expect(result.results).toEqual(["Branch 1 result", "Branch 2 result"]);

      assertEventSignatures(execution, undefined, {
        // branch-5's step is still running when the parallel completes. Its
        // result checkpoint is dropped at about 2 s, and the step then no
        // longer blocks the wait after the parallel from suspending. The wait
        // has elapsed by then. Whether the invocation suspends depends on
        // whether the SDK has already observed the elapsed wait: locally it
        // has, and in the cloud the backed-off poll can observe it later. So
        // 1 or 2 invocations are both valid. All other event counts remain
        // exact.
        invocationCompletedDifference: 1,
      });
    });
  },
});
