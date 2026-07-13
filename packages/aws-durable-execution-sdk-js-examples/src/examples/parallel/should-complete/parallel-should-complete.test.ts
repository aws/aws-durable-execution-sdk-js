import { handler } from "./parallel-should-complete";
import { createTests } from "../../../utils/test-helper";
import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  localRunnerConfig: {
    skipTime: false,
    checkpointDelay: 100,
  },
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should complete via the quorum rule when branches B and C both finish", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Branch A is slow; B and C finish first, satisfying the (B AND C) arm.
      expect(result.successCount).toBe(2);
      expect(result.completionReason).toBe("CUSTOM_COMPLETION_SUCCEEDED");
      expect(result.results).toHaveLength(2);
      expect(result.totalCount).toBe(3);

      // Unnamed branches get the auto id "parallel-branch-<index>".
      const branchA = runner.getOperation("parallel-branch-0");
      const branchB = runner.getOperation("parallel-branch-1");
      const branchC = runner.getOperation("parallel-branch-2");

      // A is still running when the quorum (B AND C) is met.
      expect(branchA?.getStatus()).toBe(OperationStatus.STARTED);
      expect(branchB?.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(branchC?.getStatus()).toBe(OperationStatus.SUCCEEDED);

      // Results are ordered by branch index, so B precedes C.
      expect(result.results).toEqual(["Branch B done", "Branch C done"]);

      assertEventSignatures(execution);
    });
  },
});
