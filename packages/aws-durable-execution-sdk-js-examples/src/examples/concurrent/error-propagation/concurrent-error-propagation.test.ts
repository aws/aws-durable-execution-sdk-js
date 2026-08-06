import { handler } from "./concurrent-error-propagation";
import { createTests } from "../../../utils/test-helper";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("propagates a rejected branch's error and fails the execution", async () => {
      const execution = await runner.run({ payload: { mode: "propagate" } });

      // throwIfError re-raised the branch error, failing the whole execution.
      // The TYPE is the point of this example: the branch's own error surfaces
      // wrapped as a ChildContextError, not as a generic batch failure.
      expect(execution.getStatus()).toBe(ExecutionStatus.FAILED);
      expect(execution.getError()?.errorType).toBe("ChildContextError");
      expect(execution.getError()?.errorMessage).toContain("branch blew up");

      assertEventSignatures(execution, "propagate");
    });

    it("reports FAILED status when a custom predicate fails the batch", async () => {
      const execution = await runner.run({
        payload: { mode: "custom-failed" },
      });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      const result = execution.getResult() as {
        status: string;
        completionReason: string;
        hasFailure: boolean;
        failureCount: number;
        successCount: number;
      };

      // The custom FAILED decision drives the batch status and reason.
      expect(result.status).toBe("FAILED");
      expect(result.completionReason).toBe("CUSTOM_COMPLETION_FAILED");
      expect(result.hasFailure).toBe(true);
      expect(result.failureCount).toBe(1);

      // No invocationCompletedDifference tolerance: with the post-batch wait
      // removed the example completes in a single invocation, so the recorded
      // InvocationCompleted count is deterministic.
      assertEventSignatures(execution, "custom-failed");
    });
  },
});
