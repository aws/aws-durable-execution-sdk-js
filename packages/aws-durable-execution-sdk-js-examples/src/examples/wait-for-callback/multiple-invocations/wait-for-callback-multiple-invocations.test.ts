import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-for-callback-multiple-invocations";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "wait-for-callback multiple invocations test",
  functionName: "wait-for-callback-multiple-invocations",
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    it("should handle multiple invocations tracking with waitForCallback operations", async () => {
      // Get operations for verification
      const firstCallbackOp = runner.getOperation("first-callback");
      const secondCallbackOp = runner.getOperation("second-callback");

      const executionPromise = runner.run({
        payload: { test: "multiple-invocations" },
      });

      // Wait for first callback to be submitted, then complete it
      await firstCallbackOp.waitForData(WaitingOperationStatus.SUBMITTED);

      const firstCallbackResult = JSON.stringify({ step: 1 });
      await firstCallbackOp.sendCallbackSuccess(firstCallbackResult);

      // Wait for second callback to be submitted, then complete it
      await secondCallbackOp.waitForData(WaitingOperationStatus.SUBMITTED);

      const secondCallbackResult = JSON.stringify({ step: 2 });
      await secondCallbackOp.sendCallbackSuccess(secondCallbackResult);

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        firstCallback: '{"step":1}',
        secondCallback: '{"step":2}',
        stepResult: { processed: true, step: 1 },
        invocationCount: "multiple",
      });

      // Verify invocations were tracked - should be 4-5 invocations
      // Due to update/termination timing, this execution may require 4-5 invocations to complete
      const invocations = result.getInvocations();
      expect(invocations.length).toBeGreaterThanOrEqual(4);
      expect(invocations.length).toBeLessThanOrEqual(5);

      // Verify operations were executed
      const operations = result.getOperations();
      expect(operations.length).toBeGreaterThan(4); // wait + callback + step + wait + callback operations
    });
  },
});
