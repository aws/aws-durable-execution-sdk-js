import {
  InvocationType,
  OperationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./create-callback-mixed-ops";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    it("should handle callback operations mixed with other operation types", async () => {
      const callbackOperation = runner.getOperation("process-user");

      const executionPromise = runner.run();

      // Wait for callback to start (other operations complete synchronously)
      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

      // Complete the callback
      const callbackResult = JSON.stringify({
        processed: true,
        timestamp: Date.now(),
      });
      await callbackOperation.sendCallbackSuccess(callbackResult);

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        stepResult: { userId: 123, name: "John Doe" },
        callbackResult: callbackResult,
        completed: true,
      });

      // Verify all operations were tracked
      const completedOperations = result.getOperations();
      expect(completedOperations.length).toEqual(3);

      const operationTypes = completedOperations.map((op) => op.getType());
      expect(operationTypes).toContain(OperationType.WAIT);
      expect(operationTypes).toContain(OperationType.STEP);
      expect(operationTypes).toContain(OperationType.CALLBACK);
    });
  },
});
