import { handler } from "./step-interrupted-no-retry";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  localRunnerConfig: {
    skipTime: true,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("should handle interrupted step with shouldRetry:false without crashing", async () => {
      // This test uses the modified history file that shows an interrupted step
      // (StepStarted but no StepSucceeded/StepFailed)
      console.log("Starting test execution...");
      const execution = await runner.run();
      console.log("Test execution completed");

      // Should not crash and should return error response
      expect(execution.getError()).toBeDefined();

      const error = execution.getError();
      expect(error?.errorType).toBe("DurableOperationError");
      // The error should indicate the step was interrupted
      expect(error?.errorMessage).toContain("Step was interrupted");

      assertEventSignatures(execution);
    }, 30000); // 30 second timeout
  },
});
