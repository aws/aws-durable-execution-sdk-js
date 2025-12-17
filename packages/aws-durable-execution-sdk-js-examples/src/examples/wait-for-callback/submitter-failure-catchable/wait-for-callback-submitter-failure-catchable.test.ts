import { InvocationType } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-for-callback-submitter-failure-catchable";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should catch submitter failure in try-catch block", async () => {
      const execution = await runner.run();

      // The handler catches the error, so execution succeeds with error in result
      const result = execution.getResult();
      expect(result).toEqual({
        success: false,
        error: expect.stringContaining("Submitter failed"),
      });

      assertEventSignatures(execution);
    });
  },
});
