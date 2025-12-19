import { InvocationType } from "@aws-sdk/client-lambda";
import { handler } from "./wait-for-callback-quick-completion";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  localRunnerConfig: {
    skipTime: false,
  },
  tests: (runner, { isCloud, assertEventSignatures }) => {
    it("should handle waitForCallback when callback completes before ", async () => {
      const callbackOp = runner.getOperationByIndex(0);

      const executionPromise = runner.run({
        payload: isCloud
          ? {
              submitterDelay: 5,
            }
          : {},
      });

      // only wait for started status
      await callbackOp.waitForData();

      await callbackOp.sendCallbackSuccess("{}");

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        callbackResult: "{}",
        success: true,
      });
      expect(result.getInvocations().length).toBe(1);

      assertEventSignatures(result);
    });
  },
});
