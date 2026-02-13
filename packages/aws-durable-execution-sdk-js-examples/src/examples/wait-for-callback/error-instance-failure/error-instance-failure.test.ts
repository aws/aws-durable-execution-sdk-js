import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./error-instance-failure";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should catch CallbackError for callback failure", async () => {
      const executionPromise = runner.run({ payload: {} });

      const callback = runner.getOperationByIndex(0);
      await callback.waitForData(WaitingOperationStatus.SUBMITTED);
      await callback.sendCallbackFailure({ ErrorMessage: "Callback failed" });

      const result = await executionPromise;
      const errorCheck = result.getResult() as any;

      expect(errorCheck.isCallbackError).toBe(true);
      expect(errorCheck.errorName).toBe("CallbackError");
      expect(errorCheck.errorMessage).toBe("Callback failed");

      assertEventSignatures(result, "failure", {
        invocationCompletedDifference: 1,
      });
    });
  },
});
