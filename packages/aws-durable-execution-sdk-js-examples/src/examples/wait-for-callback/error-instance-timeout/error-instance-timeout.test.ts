import { InvocationType } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./error-instance-timeout";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should catch CallbackTimeoutError for callback timeout", async () => {
      const result = await runner.run({ payload: {} });
      const errorCheck = result.getResult() as any;

      expect(errorCheck.isCallbackTimeoutError).toBe(true);
      expect(errorCheck.errorName).toBe("CallbackTimeoutError");
      expect(errorCheck.errorMessage).toBe("Callback timed out");

      assertEventSignatures(result, "timeout", {
        invocationCompletedDifference: 1,
      });
    });
  },
});
