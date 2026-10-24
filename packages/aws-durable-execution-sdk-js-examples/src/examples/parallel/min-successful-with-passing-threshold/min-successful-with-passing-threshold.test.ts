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

      // branch-1 and branch-2 record their outcome first and complete the
      // batch. branch-3 and branch-4 finish in the same turn as branch-2,
      // but after the decision, so history keeps them STARTED, as the result
      // does (issue #967).
      expect(branch1?.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(branch2?.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(branch3?.getStatus()).toBe(OperationStatus.STARTED);
      expect(branch4?.getStatus()).toBe(OperationStatus.STARTED);
      expect(branch5?.getStatus()).toBe(OperationStatus.STARTED);

      // Verify the results array matches
      expect(result.results).toEqual(["Branch 1 result", "Branch 2 result"]);

      assertEventSignatures(execution, undefined, {
        // branch-5's step is still running when the batch completes. Its
        // result checkpoint is dropped, which lets the wait after the
        // parallel suspend. Whether it suspends depends on whether the wait
        // has already elapsed when branch-5's step ends: locally it has, and
        // in the cloud it has not. So 1 or 2 invocations are both valid. All
        // other event counts remain exact.
        invocationCompletedDifference: 1,
      });
    });
  },
});
