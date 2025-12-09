import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-for-callback-anonymous";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    it("should handle basic waitForCallback with anonymous submitter", async () => {
      // Start the execution (this will pause at the callback)
      const executionPromise = runner.run();

      const callbackOperation = runner.getOperationByIndex(1);

      // Wait for the operation to be available
      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);
      const callbackResult = JSON.stringify({
        data: "callback_completed",
      });
      // Simulate external system completing the callback
      await callbackOperation.sendCallbackSuccess(callbackResult);

      // Now the execution should complete
      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        callbackResult: callbackResult,
        completed: true,
      });

      // Verify operations were tracked
      expect(result.getOperations().length).toBeGreaterThan(0);
    });
  },
});
