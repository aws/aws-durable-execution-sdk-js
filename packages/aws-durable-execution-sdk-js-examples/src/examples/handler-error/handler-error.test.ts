import { handler } from "./handler-error";
import { createTests } from "../../utils/test-helper";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  name: "handler-error test",
  functionName: "handler-error",
  handler,
  tests: (runner) => {
    it("should handle handler errors gracefully and capture error details", async () => {
      const result = await runner.run({ payload: { test: "error-case" } });

      // Check that error was captured in the result
      const error = result.getError();
      expect(error).toEqual({
        errorMessage: "Intentional handler failure",
        errorType: "Error",
        stackTrace: expect.any(Array),
      });

      // Verify stack trace structure
      expect(error.stackTrace?.length).toBeGreaterThan(1);
      error.stackTrace?.forEach((value) => {
        expect(typeof value).toBe("string");
      });

      // Verify no operations were completed due to early error
      expect(result.getOperations()).toHaveLength(0);

      expect(result.getStatus()).toBe(ExecutionStatus.FAILED);
    });
  },
});
