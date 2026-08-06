import { handler } from "./concurrent-cancellation";
import { createTests } from "../../../utils/test-helper";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  localRunnerConfig: {
    skipTime: false,
    checkpointDelay: 100,
  },
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("cancels in-flight and unstarted siblings once minSuccessful is reached", async () => {
      const execution = await runner.run({
        payload: { mode: "min-successful" },
      });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      const result = execution.getResult() as {
        completionReason: string;
        successCount: number;
        startedCount: number;
        totalCount: number;
        results: string[];
      };

      expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
      expect(result.successCount).toBe(1);
      // One branch was still in flight (STARTED) when the batch completed...
      expect(result.startedCount).toBe(1);
      // ...and the two never-launched branches are absent entirely, so the
      // total is only the two that were started (not all four). These exact
      // counts hold because of the 20x gap between the fast (100ms) and slow
      // (2000ms) branches: branch 0 trips minSuccessful long before branch 1
      // could finish, even under a loaded scheduler (see the handler comment).
      expect(result.totalCount).toBe(2);
      expect(result.results).toEqual(["branch 0 (fast)"]);

      // No invocationCompletedDifference tolerance: with no post-batch wait the
      // whole example runs in a single invocation (the handler returns as soon
      // as the batch completes early), so the InvocationCompleted count is
      // deterministic and asserted exactly.
      assertEventSignatures(execution, "min-successful");
    }, 15000);

    it("declines the batch up front via a guard predicate", async () => {
      const execution = await runner.run({ payload: { mode: "guard" } });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      const result = execution.getResult() as {
        thrownErrorType?: string;
        status: string;
        completionReason: string;
        totalCount: number;
        startedCount: number;
      };

      // No branch ran, so the batch is empty.
      expect(result.totalCount).toBe(0);
      expect(result.startedCount).toBe(0);
      // The FAILED custom completion drives status and reason...
      expect(result.status).toBe("FAILED");
      expect(result.completionReason).toBe("CUSTOM_COMPLETION_FAILED");
      // ...and with no item error, throwIfError raises a BatchCompletionError.
      expect(result.thrownErrorType).toBe("BatchCompletionError");

      assertEventSignatures(execution, "guard");
    });
  },
});
