import {
  InvocationType,
  OperationStatus,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-for-callback-mixed-ops";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    it("should handle waitForCallback mixed with steps, waits, and other operations", async () => {
      const callbackOperation = runner.getOperation("wait-for-callback");

      const executionPromise = runner.run();

      // Wait for callback to start (other operations complete synchronously with skipTime)
      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

      // Complete the callback
      const callbackResult = JSON.stringify({ processed: true });
      await callbackOperation.sendCallbackSuccess(callbackResult);

      const result = await executionPromise;

      const resultData = result.getResult() as {
        stepResult: { userId: number; name: string };
        callbackResult: { processed: boolean };
        finalStep: { status: string; timestamp: number };
        workflowCompleted: boolean;
      };

      expect(resultData).toMatchObject({
        stepResult: { userId: 123, name: "John Doe" },
        callbackResult: JSON.stringify({ processed: true }),
        finalStep: { status: "completed" },
        workflowCompleted: true,
      });
      expect(typeof resultData.finalStep.timestamp).toBe("number");

      // Verify all operations were tracked - should have wait, step, waitForCallback (context + callback + submitter), wait, step
      const completedOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(completedOperations.length).toBe(7);
    });
  },
});
