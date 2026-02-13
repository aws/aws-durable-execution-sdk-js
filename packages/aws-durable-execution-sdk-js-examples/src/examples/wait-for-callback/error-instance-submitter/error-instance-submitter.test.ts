import { InvocationType } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./error-instance-submitter";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should catch CallbackSubmitterError for submitter failure", async () => {
      const result = await runner.run({ payload: {} });
      const errorCheck = result.getResult() as any;

      expect(errorCheck.isCallbackSubmitterError).toBe(true);
      expect(errorCheck.errorName).toBe("CallbackSubmitterError");
      expect(errorCheck.errorMessage).toBe("Submitter failed");

      assertEventSignatures(result, "submitter", {
        invocationCompletedDifference: 1,
      });
    });
  },
});
