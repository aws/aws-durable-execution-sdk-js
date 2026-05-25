import { handler } from "./step-interrupted-no-retry";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should convert generic Error to StepError when shouldRetry is false", async () => {
      const execution = await runner.run();

      // Should return error response
      expect(execution.getError()).toBeDefined();

      const error = execution.getError();

      // Our fix ensures that generic errors thrown in steps are properly
      // converted to StepError (which extends DurableOperationError)
      // instead of remaining as generic "Error" types
      expect(error?.errorType).toBe("StepError");
      expect(error?.errorMessage).toContain("Test error");

      assertEventSignatures(execution);
    });
  },
});
