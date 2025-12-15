import { handler } from "./handler-error";
import { createTests } from "../../utils/test-helper";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should handle handler errors gracefully and capture error details", async () => {
      const result = await runner.run({ payload: { test: "error-case" } });

      // Check that error was captured in the result
      const error = result.getError();
      expect(error).toEqual({
        errorMessage: "Intentional handler failure",
        errorType: "Error",
        stackTrace: undefined,
      });

      // Verify no operations were completed due to early error
      expect(result.getOperations()).toHaveLength(0);

      expect(result.getStatus()).toBe(ExecutionStatus.FAILED);

      assertEventSignatures(result);
    });
  },
});
