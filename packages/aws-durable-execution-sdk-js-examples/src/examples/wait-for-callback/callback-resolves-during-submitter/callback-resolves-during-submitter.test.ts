import { WaitingOperationStatus } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./callback-resolves-during-submitter";
import { createTests } from "../../../utils/test-helper";

/**
 * Regression test for #544: TimerScheduler.hasScheduledFunction() must remain
 * true while a fired timer's updateCheckpoint / startInvocation chain is still
 * settling.
 *
 * Scenario (skipTime: false → TimerScheduler):
 *   1. Handler calls waitForCallback with a slow async submitter (~500 ms).
 *   2. The callback operation reaches STARTED immediately; the test sends
 *      callbackSuccess while the submitter is still running.
 *   3. The callback-completion timer fires, synchronously deletes itself from
 *      runningTimers, removes the callback from pendingOperations, and attempts
 *      startInvocation — which is skipped because the first invocation is
 *      still active.
 *   4. The submitter finishes; the handler returns PENDING.
 *   5. invokeHandler checks hasScheduledFunction() and pendingOperations. With
 *      the old code both are empty → spurious rejection
 *      "Cannot return PENDING status with no pending operations."
 *
 * The fix keeps the timer entry in runningTimers until the full
 * updateCheckpoint → startInvocation chain settles, so hasScheduledFunction()
 * correctly returns true at step 5.
 */
createTests({
  handler,
  localRunnerConfig: {
    skipTime: false,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("should complete when callback resolves while submitter is still running", async () => {
      const callbackOp = runner.getOperation("delayed-submitter");

      const executionPromise = runner.run();

      // Wait for the callback to be created (STARTED), then immediately
      // resolve it externally — while the submitter is still sleeping.
      await callbackOp.waitForData(WaitingOperationStatus.STARTED);
      await callbackOp.sendCallbackSuccess(
        JSON.stringify({ data: "resolved-during-submitter" }),
      );

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        callbackResult: '{"data":"resolved-during-submitter"}',
        completed: true,
      });

      assertEventSignatures(result);
    });
  },
});
