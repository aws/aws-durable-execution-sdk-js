import { handler } from "./step-interrupted-no-retry";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner) => {
    it("should wrap error as DurableOperationError when shouldRetry is false", async () => {
      const execution = await runner.run();

      // Should return error response wrapped as DurableOperationError
      expect(execution.getError()).toBeDefined();

      const error = execution.getError();
      expect(error?.errorType).toBe("DurableOperationError");
    });
  },
});
