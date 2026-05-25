import { handler } from "./step-interrupted-no-retry";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  localRunnerConfig: {
    skipTime: true,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("should handle interrupted step with shouldRetry:false without crashing", async () => {
      const execution = await runner.run();

      // Should not crash and should return error response
      expect(execution.getError()).toBeDefined();

      const error = execution.getError();
      expect(error?.errorType).toBe("DurableOperationError");
      // The error message should indicate the step was interrupted
      expect(error?.errorMessage).toContain("Step was interrupted");

      assertEventSignatures(execution);
    });

    it("should complete successfully on first run without interruption", async () => {
      // Mock setTimeout to resolve immediately for testing
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((callback: () => void) => {
        callback();
        return 1 as any;
      }) as any;

      try {
        const execution = await runner.run();

        expect(execution.getResult()).toEqual({
          success: true,
          result: "This should not complete",
        });

        assertEventSignatures(execution, "success");
      } finally {
        global.setTimeout = originalSetTimeout;
      }
    });
  },
});
