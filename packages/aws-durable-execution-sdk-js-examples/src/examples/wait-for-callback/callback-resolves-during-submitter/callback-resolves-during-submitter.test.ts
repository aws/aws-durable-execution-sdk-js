import { WaitingOperationStatus } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./callback-resolves-during-submitter";
import { createTests } from "../../../utils/test-helper";

/**
 * Covers waitForCallback when an external caller resolves the callback while
 * the submitter is still running.
 *
 * The completion is delivered to the running invocation in the response to the
 * submitter step's own checkpoint, so the execution never suspends and finishes
 * in a single invocation.
 *
 * This is coverage for the callback flow, not a regression test for the
 * TimerScheduler PENDING-validation race (#544). That race needs an invocation
 * to return PENDING while a fired timer's checkpoint update is still in flight,
 * which an example handler cannot schedule deterministically. It is covered by
 * "should not reject when a fired timer's checkpoint update is still in flight"
 * in test-execution-orchestrator-pending-rejection.test.ts.
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
