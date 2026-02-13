import { handler } from "./error-instance";
import { createTests } from "../../../utils/test-helper";
import { InvocationType } from "@aws/durable-execution-sdk-js-testing";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should catch correct error instances for failure, timeout, and submitter", async () => {
      const callbackOp = runner.getOperation("failure-test");

      const executionPromise = runner.run({ payload: {} });

      // Wait for the operation to start
      await callbackOp.waitForData();

      // Send failure to first callback
      await callbackOp.sendCallbackFailure({
        ErrorMessage: "Callback failed",
      });

      const result = await executionPromise;
      const errorCheck = result.getResult();

      expect(errorCheck).toEqual({
        failureError: {
          isCallbackError: true,
          errorName: "CallbackError",
          errorMessage: "Callback failed",
        },
        timeoutError: {
          isCallbackTimeoutError: true,
          errorName: "CallbackTimeoutError",
          errorMessage: "Callback timed out",
        },
        submitterError: {
          isCallbackSubmitterError: true,
          errorName: "CallbackSubmitterError",
          errorMessage: "Submitter failed",
        },
      });

      assertEventSignatures(result);
    });
  },
});
