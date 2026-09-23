import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./map-wait-for-callback";
import { createTests } from "../../../utils/test-helper";

/**
 * Regression test for issue #510:
 * context.map branches with waitForCallback do not progress after all callbacks signal;
 * execution wedges until an unrelated timer resumes it.
 *
 * The test verifies that after ALL branch callbacks complete, the orchestrator
 * immediately advances to the next ctx.step — without requiring any external timer.
 */
createTests({
  handler,
  invocationType: InvocationType.Event,
  localRunnerConfig: { skipTime: false },
  tests: (runner, { assertEventSignatures }) => {
    it("should advance to after-map step immediately once all branch callbacks complete", async () => {
      const cb0 = runner.getOperation("wait-0");
      const cb1 = runner.getOperation("wait-1");

      const executionPromise = runner.run();

      // Wait for both branches to be waiting for their callbacks.
      // Register both waits concurrently so neither can be missed if the
      // SDK processes both submitter steps in the same checkpoint batch.
      await Promise.all([
        cb0.waitForData(WaitingOperationStatus.SUBMITTED),
        cb1.waitForData(WaitingOperationStatus.SUBMITTED),
      ]);

      // Signal branch 0 first (mirrors the bug report: partial callbacks arrive first)
      await cb0.sendCallbackSuccess("result-0");

      // Signal the last branch — this is the moment the bug manifests:
      // the service should schedule an immediate resume, not wait for a timer.
      await cb1.sendCallbackSuccess("result-1");

      const execution = await executionPromise;

      expect(execution.getResult()).toEqual([
        "processed:result-0",
        "processed:result-1",
      ]);

      assertEventSignatures(execution);
    });
  },
});
