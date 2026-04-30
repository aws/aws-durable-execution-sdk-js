import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./map-wait-for-callback-parallel";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  localRunnerConfig: { skipTime: false },
  tests: (runner, { assertEventSignatures }) => {
    it("map completes before watchdog timer: body.after-map should run immediately after last callback", async () => {
      const cb0 = runner.getOperation("wait-0");
      const cb1 = runner.getOperation("wait-1");

      const startMs = Date.now();
      const executionPromise = runner.run();

      // Register both waits concurrently.
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

      // Must complete well before the 30-second watchdog. If we hit or pass
      // the watchdog, that indicates the body branch wedged until the
      // watchdog timer fired (the bug shape from issue #510).
      expect(elapsedMs).toBeLessThan(20000);

      // The result must be from the body branch (processed:*) — not just
      // the watchdog (watchdog-done). If we see only watchdog-done, the body
      // branch never advanced, which is the exact failure from issue #510.
      const result = execution.getResult();
      expect(JSON.stringify(result)).toContain("processed:");

      // Cloud mode may produce a different invocation count than local due to
      // differing re-invocation timing (especially with callbacks arriving
      // close together). Allow some tolerance — the important checks above
      // (elapsed time, result content) already validate correct behavior.
      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 3,
      });
    }, 60000);
  },
});
