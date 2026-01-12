import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./parallel-min-successful-callback";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should succeed when only one of three callbacks completes (minSuccessful:1)", async () => {
      const callback1Op = runner.getOperation("branch-1-callback");
      const callback2Op = runner.getOperation("branch-2-callback");
      const callback3Op = runner.getOperation("branch-3-callback");

      const executionPromise = runner.run();

      await callback1Op.waitForData(WaitingOperationStatus.STARTED);
      await callback2Op.waitForData(WaitingOperationStatus.STARTED);
      await callback3Op.waitForData(WaitingOperationStatus.STARTED);

      // Complete ONLY callback 1 - callbacks 2 and 3 remain pending
      // This tests that multiple pending callbacks all properly detect
      // the ancestor is finished and skip termination
      await callback1Op.sendCallbackSuccess("result-1");

      const execution = await executionPromise;

      // Verify callback 1 succeeded
      expect(callback1Op.getCallbackDetails()?.result).toBe("result-1");

      // Verify parallel succeeded with minSuccessful:1
      const results = execution.getResult() as string[];
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]).toBe("result-1");

      assertEventSignatures(execution);
    }, 10000);
  },
});
