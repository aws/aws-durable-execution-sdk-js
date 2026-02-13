import {
  handlerFailure,
  handlerTimeout,
  handlerSubmitter,
} from "./error-instance";
import { createTests } from "../../../utils/test-helper";
import { InvocationType } from "@aws/durable-execution-sdk-js-testing";

createTests({
  handler: handlerFailure,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should catch CallbackError for callback failure", async () => {
      const callbackOp = runner.getOperation("failure-test");
      const executionPromise = runner.run({ payload: {} });

      await callbackOp.waitForData();
      await callbackOp.sendCallbackFailure({
        ErrorMessage: "Callback failed",
      });

      const result = await executionPromise;
      const errorCheck = result.getResult() as any;

      expect(errorCheck.failureError.isCallbackError).toBe(true);
      expect(errorCheck.failureError.errorName).toBe("CallbackError");
      expect(errorCheck.failureError.errorMessage).toBe("Callback failed");

      assertEventSignatures(result, undefined, {
        invocationCompletedDifference: 1,
      });
    });
  },
});

createTests({
  handler: handlerTimeout,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should catch CallbackTimeoutError for callback timeout", async () => {
      const result = await runner.run({ payload: {} });
      const errorCheck = result.getResult() as any;

      expect(errorCheck.timeoutError.isCallbackTimeoutError).toBe(true);
      expect(errorCheck.timeoutError.errorName).toBe("CallbackTimeoutError");
      expect(errorCheck.timeoutError.errorMessage).toBe("Callback timed out");

      assertEventSignatures(result, "timeout", {
        invocationCompletedDifference: 1,
      });
    });
  },
});

createTests({
  handler: handlerSubmitter,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should catch CallbackSubmitterError for submitter failure", async () => {
      const result = await runner.run({ payload: {} });
      const errorCheck = result.getResult() as any;

      expect(errorCheck.submitterError.isCallbackSubmitterError).toBe(true);
      expect(errorCheck.submitterError.errorName).toBe(
        "CallbackSubmitterError",
      );
      expect(errorCheck.submitterError.errorMessage).toBe("Submitter failed");

      assertEventSignatures(result, "submitter", {
        invocationCompletedDifference: 1,
      });
    });
  },
});
