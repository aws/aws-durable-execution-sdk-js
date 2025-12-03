import { handler } from "./handler-error";
import historyEvents from "./handler-error.history.json";
import { createTests } from "../../utils/test-helper";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  name: "handler-error test",
  functionName: "handler-error",
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

      assertEventSignatures(result.getHistoryEvents(), historyEvents);
    });
  },
});
