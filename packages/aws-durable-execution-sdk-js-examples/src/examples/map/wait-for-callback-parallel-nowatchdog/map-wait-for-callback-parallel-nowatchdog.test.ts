import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./map-wait-for-callback-parallel-nowatchdog";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  localRunnerConfig: { skipTime: false },
  tests: (runner, { assertEventSignatures }) => {
    it("no watchdog: body.after-map should still run immediately after last callback", async () => {
      const cb0 = runner.getOperation("wait-0");
      const cb1 = runner.getOperation("wait-1");

      const startMs = Date.now();
      const executionPromise = runner.run();

      await Promise.all([
        cb0.waitForData(WaitingOperationStatus.SUBMITTED),
        cb1.waitForData(WaitingOperationStatus.SUBMITTED),
      ]);

      await Promise.all([
        cb0.sendCallbackSuccess("result-0"),
        cb1.sendCallbackSuccess("result-1"),
      ]);

      const execution = await executionPromise;
      const elapsedMs = Date.now() - startMs;

      // Allow reasonable cloud latency. With no watchdog, only callbacks
      // can unblock the execution, so a hang would manifest as an execution
      // timeout rather than a specific elapsed-time pattern.
      expect(elapsedMs).toBeLessThan(20000);

      // Verify body branch completed (catches the bug shape where the map
      // wedges and execution only finishes via external timer).
      const result = execution.getResult();
      expect(JSON.stringify(result)).toContain("processed:");

      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 3,
      });
    }, 30000);
  },
});
