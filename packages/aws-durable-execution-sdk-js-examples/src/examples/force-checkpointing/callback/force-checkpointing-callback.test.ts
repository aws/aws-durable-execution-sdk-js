import { handler } from "./force-checkpointing-callback";
import { createTests } from "../../../utils/test-helper";
import {
  ExecutionStatus,
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    it("should complete with force checkpointing when one branch blocks termination with multiple callbacks", async () => {
      const startTime = Date.now();

      const callback1 = runner.getOperation("callback-1");
      const callback2 = runner.getOperation("callback-2");
      const callback3 = runner.getOperation("callback-3");

      const executionPromise = runner.run();

      // Wait for first callback to start and send success
      await callback1.waitForData(WaitingOperationStatus.STARTED);
      await callback1.sendCallbackSuccess("callback-1-done");

      // Wait for second callback to start and send success
      await callback2.waitForData(WaitingOperationStatus.STARTED);
      await callback2.sendCallbackSuccess("callback-2-done");

      // Wait for third callback to start and send success
      await callback3.waitForData(WaitingOperationStatus.STARTED);
      await callback3.sendCallbackSuccess("callback-3-done");

      const execution = await executionPromise;

      const duration = Date.now() - startTime;

      // Verify the result
      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      const result = JSON.parse(execution.getResult() as string);
      expect(result.completionReason).toBe("ALL_COMPLETED");
      expect(result.all).toHaveLength(2);
      expect(result.all[0].result).toBe("long-complete");
      expect(result.all[1].result).toBe("callbacks-complete");

      // Should complete in less than 15 seconds
      // (10s for long-running step + time for callbacks)
      expect(duration).toBeLessThan(15000);

      // Should complete in a single invocation
      // The long-running step prevents termination, so the callback operations
      // use force checkpoint to get status updates without terminating
      const invocations = execution.getInvocations();
      expect(invocations).toHaveLength(1);

      // Verify operations were tracked
      const operations = execution.getOperations();
      expect(operations.length).toBeGreaterThan(0);
    }, 50000);
  },
});
