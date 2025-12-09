import {
  InvocationType,
  OperationStatus,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-for-callback-heartbeat-sends";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  localRunnerConfig: {
    skipTime: false,
  },
  tests: (runner, { isCloud }) => {
    it("should handle waitForCallback heartbeat scenarios during long-running submitter execution", async () => {
      const executionPromise = runner.run({
        payload: { isCloud },
      });

      const callbackOperation = runner.getOperationByIndex(1);

      // Wait for the operation to be available
      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

      // Send heartbeat to keep the callback alive during processing
      await callbackOperation.sendCallbackHeartbeat();

      // Wait a bit more to simulate callback processing time
      await new Promise((resolve) => setTimeout(resolve, isCloud ? 7000 : 600));

      // Send another heartbeat
      await callbackOperation.sendCallbackHeartbeat();

      // Finally complete the callback
      const callbackResult = JSON.stringify({
        processed: 1000,
      });
      await callbackOperation.sendCallbackSuccess(callbackResult);

      const result = await executionPromise;

      const resultData = result.getResult() as {
        callbackResult: string;
        completed: boolean;
      };

      expect(resultData.callbackResult).toEqual(callbackResult);
      expect(resultData.completed).toBe(true);

      // Should have completed operations with successful callback
      const completedOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(completedOperations.length).toBeGreaterThan(0);
    });
  },
});
