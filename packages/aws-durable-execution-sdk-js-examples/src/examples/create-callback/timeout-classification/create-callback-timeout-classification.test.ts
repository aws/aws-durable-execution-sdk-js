import { InvocationType } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./create-callback-timeout-classification";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  // Real timers so the 1s callback timeout actually elapses during the longer
  // in-invocation step, and the timeout is classified by createCallbackPromise
  // on the same invocation rather than on a later replay.
  localRunnerConfig: { skipTime: false },
  tests: (runner, { assertEventSignatures }) => {
    it("rejects an unanswered callback with a CallbackTimeoutError", async () => {
      const execution = await runner.run();

      // The deterministic contract of this example is the error *classification*:
      // an unanswered callback rejects with a CallbackTimeoutError (a
      // CallbackError subclass) carrying a stable errorType and message. Those
      // assertions hold regardless of scheduling.
      expect(execution.getResult()).toEqual({
        approved: false,
        timedOut: true,
        isCallbackError: true,
        isTimeoutError: true,
        errorType: "CallbackTimeoutError",
        message: "Callback timed out",
      });

      // Policy: whether the timeout is classified on the invocation that awaits
      // the callback or on a later replay depends on a real-time race between
      // the 1s callback timeout and the 2s in-step sleep, so the exact
      // invocation count is deliberately NOT asserted — it can flip on a loaded
      // runner. (This mirrors the sibling failure-error-details example.) For
      // the same reason the recorded InvocationCompleted count is allowed to
      // differ by one. The reconstructed error above is identical either way.
      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 1,
      });
    });
  },
});
