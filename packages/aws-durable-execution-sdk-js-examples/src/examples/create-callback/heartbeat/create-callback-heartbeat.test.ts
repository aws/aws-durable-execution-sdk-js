import { handler } from "./create-callback-heartbeat";
import { createTests } from "../../../utils/test-helper";
import { InvocationType } from "@aws-sdk/client-lambda";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { isCloud, assertEventSignatures }) => {
    it("should handle callback heartbeats during long-running tasks", async () => {
      const callbackOperation = runner.getOperation("long-running-task");

      const executionPromise = runner.run({
        payload: { isCloud },
      });

      // Wait for callback to start
      await callbackOperation.waitForData();

      // Wait based on environment - longer for cloud polling intervals
      const waitTime = isCloud ? 10000 : 600;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      // Send heartbeat to prevent timeout
      await callbackOperation.sendCallbackHeartbeat();
      // Wait again
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      const callbackResult = JSON.stringify({
        processed: 1000,
        status: "completed",
      });

      // Finally complete the callback
      await callbackOperation.sendCallbackSuccess(callbackResult);

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        longTaskResult: callbackResult,
      });

      assertEventSignatures(result);
    });
  },
});
