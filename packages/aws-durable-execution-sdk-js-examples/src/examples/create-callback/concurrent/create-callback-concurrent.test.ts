import {
  InvocationType,
  OperationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./create-callback-concurrent";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    it("should handle multiple concurrent callback operations", async () => {
      // Get all callback operations
      const callback1 = runner.getOperation("api-call-1");
      const callback2 = runner.getOperation("api-call-2");
      const callback3 = runner.getOperation("api-call-3");

      const executionPromise = runner.run();

      // Wait for all callbacks to start
      await Promise.all([
        callback1.waitForData(WaitingOperationStatus.STARTED),
        callback2.waitForData(WaitingOperationStatus.STARTED),
        callback3.waitForData(WaitingOperationStatus.STARTED),
      ]);

      // Complete callbacks in different order
      const callbackResult2 = JSON.stringify({
        id: 2,
        data: "second",
      });
      await callback2.sendCallbackSuccess(callbackResult2);
      const callbackResult1 = JSON.stringify({
        id: 1,
        data: "first",
      });
      await callback1.sendCallbackSuccess(callbackResult1);
      const callbackResult3 = JSON.stringify({
        id: 3,
        data: "third",
      });
      await callback3.sendCallbackSuccess(callbackResult3);

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        results: [callbackResult1, callbackResult2, callbackResult3],
        allCompleted: true,
      });

      // Verify all callback operations were tracked
      const completedOperations = result.getOperations();
      expect(completedOperations.length).toEqual(3);
      expect(
        completedOperations.every(
          (op) => op.getType() === OperationType.CALLBACK,
        ),
      ).toBe(true);
    });
  },
});
