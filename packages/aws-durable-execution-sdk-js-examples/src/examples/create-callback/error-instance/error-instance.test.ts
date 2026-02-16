import { InvocationType } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./error-instance";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should catch correct error instances for timeout and failure", async () => {
      const callbackOp2 = runner.getOperation("failure-test");

      const executionPromise = runner.run({ payload: {} });

      // Wait for second callback to start
      await callbackOp2.waitForData();

      // Send failure to second callback
      await callbackOp2.sendCallbackFailure({
        ErrorMessage: "Callback failed",
      });

      const result = await executionPromise;
      const errorCheck = result.getResult();

      expect(errorCheck).toEqual({
        timeoutError: {
          isCallbackTimeoutError: true,
          errorName: "CallbackTimeoutError",
          errorMessage: "Callback timed out",
        },
        failureError: {
          isCallbackError: true,
          errorName: "CallbackError",
          errorMessage: "Callback failed",
        },
      });

      assertEventSignatures(result);
    });
  },
});
