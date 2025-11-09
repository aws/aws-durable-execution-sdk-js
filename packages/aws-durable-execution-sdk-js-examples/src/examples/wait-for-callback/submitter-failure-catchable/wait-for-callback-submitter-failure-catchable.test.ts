import { InvocationType } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-for-callback-submitter-failure-catchable";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "wait-for-callback-submitter-failure-catchable test",
  functionName: "wait-for-callback-submitter-failure-catchable",
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    it("should catch submitter failure in try-catch block", async () => {
      const execution = await runner.run();

      // The handler catches the error, so execution succeeds with error in result
      const result = execution.getResult();
      expect(result).toEqual({
        success: false,
        error: expect.stringContaining("Submitter failed"),
      });
    });

    it("should handle submitter failure gracefully after retries", async () => {
      const execution = await runner.run();

      // Verify error is caught and returned in response
      const result = execution.getResult() as any;
      expect(result.success).toBe(false);
      expect(result.error).toContain("Submitter failed");

      // Execution completes successfully (doesn't hang or throw unhandled error)
      expect(execution.getResult()).toBeDefined();
    });
  },
});
