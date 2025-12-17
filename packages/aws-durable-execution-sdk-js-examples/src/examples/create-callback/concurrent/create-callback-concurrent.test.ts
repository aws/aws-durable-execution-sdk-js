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
  tests: (runner, { assertEventSignatures }) => {
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

      // Wait a bit to ensure invocations complete (TODO: add a waitForInvocation to testing lib)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Complete callbacks in different order
      const callbackResult2 = JSON.stringify({
        id: 2,
        data: "second",
      });
      const callbackResult1 = JSON.stringify({
        id: 1,
        data: "first",
      });
      const callbackResult3 = JSON.stringify({
        id: 3,
        data: "third",
      });
      await Promise.all([
        callback2.sendCallbackSuccess(callbackResult2),
        callback1.sendCallbackSuccess(callbackResult1),
        callback3.sendCallbackSuccess(callbackResult3),
      ]);

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

      assertEventSignatures(result, undefined, {
        invocationCompletedDifference: 2,
      });
    });
  },
});
