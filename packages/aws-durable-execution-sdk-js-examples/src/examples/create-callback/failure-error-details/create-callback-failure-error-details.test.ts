import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./create-callback-failure-error-details";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  // skipTime:false keeps the callback failure on the same invocation that is
  // awaiting it (the callback completes before the invocation is suspended),
  // so the failure is classified by createCallbackPromise rather than on a
  // later replay invocation.
  localRunnerConfig: { skipTime: false },
  tests: (runner, { assertEventSignatures }) => {
    it("reconstructs error type, machine-readable data, and stack from a rich failure", async () => {
      const callbackOp = runner.getOperation("charge-payment");

      const executionPromise = runner.run();

      await callbackOp.waitForData(WaitingOperationStatus.STARTED);

      const errorData = JSON.stringify({
        code: "insufficient_funds",
        retryable: false,
      });
      const stackTrace = [
        "PaymentDeclinedException: Card declined by issuer",
        "    at chargeCard (payments.js:42:11)",
        "    at processPayment (payments.js:18:5)",
      ];

      await callbackOp.sendCallbackFailure({
        ErrorMessage: "Card declined by issuer",
        ErrorType: "PaymentDeclinedException",
        ErrorData: errorData,
        StackTrace: stackTrace,
      });

      const execution = await executionPromise;

      expect(execution.getResult()).toEqual({
        settled: false,
        errorType: "CallbackExternalError",
        message: "Card declined by issuer",
        errorData,
        isCallbackError: true,
        isExternalError: true,
        cause: {
          name: "PaymentDeclinedException",
          message: "Card declined by issuer",
          stack: stackTrace.join("\n"),
        },
      });

      // Note: whether the failure is classified in this invocation or on a
      // later replay depends on real-time scheduling, so it is deliberately not
      // asserted here. The reconstructed error above is identical either way.
      // For the same reason the invocation count in the recorded history is
      // allowed to differ by one.
      assertEventSignatures(execution, "detailed", {
        invocationCompletedDifference: 1,
      });
    });

    it("falls back to default message and name when the failure omits them", async () => {
      const callbackOp = runner.getOperation("charge-payment");

      const executionPromise = runner.run();

      await callbackOp.waitForData(WaitingOperationStatus.STARTED);

      // Sparse failure: only machine-readable data, no message / type / stack.
      const errorData = JSON.stringify({ code: "gateway_unavailable" });
      await callbackOp.sendCallbackFailure({ ErrorData: errorData });

      const execution = await executionPromise;

      expect(execution.getResult()).toEqual({
        settled: false,
        errorType: "CallbackExternalError",
        message: "Callback failed",
        errorData,
        isCallbackError: true,
        isExternalError: true,
        cause: {
          name: "Error",
          message: "",
          stack: undefined,
        },
      });

      // See note above: the classifying invocation is timing-dependent and is
      // intentionally not asserted.
      assertEventSignatures(execution, "sparse", {
        invocationCompletedDifference: 1,
      });
    });
  },
});
