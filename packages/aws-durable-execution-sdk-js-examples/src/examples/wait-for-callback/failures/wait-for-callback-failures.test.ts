import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-for-callback-failures";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    it("should handle waitForCallback with callback failure scenarios", async () => {
      // Start the execution (this will pause at the callback)
      const executionPromise = runner.run();

      const callbackOperation = runner.getOperationByIndex(1);

      // Wait for the operation to be available (submitter succeeded)
      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

      // Simulate external system failing the callback
      await callbackOperation.sendCallbackFailure({
        ErrorMessage: "External API failure",
        ErrorType: "APIException",
      });

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        success: false,
        error: "External API failure",
      });

      const completedOperations = result.getOperations();
      expect(completedOperations.length).toEqual(3);
    });
  },
});
