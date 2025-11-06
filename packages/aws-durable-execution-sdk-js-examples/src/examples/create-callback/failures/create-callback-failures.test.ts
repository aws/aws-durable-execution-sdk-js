import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./create-callback-failures";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "create-callback-failures test",
  functionName: "create-callback-failures",
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    it("should handle callback operations with failure", async () => {
      const callbackOperation = runner.getOperation("failing-operation");

      const executionPromise = runner.run({
        payload: { shouldCatchError: false },
      });

      // Wait for callback to start
      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

      await callbackOperation.sendCallbackFailure({
        ErrorMessage: "External API failure",
        ErrorType: "APIException",
      });

      const result = await executionPromise;

      // Expect the actual error message sent via sendCallbackFailure
      expect(result.getError()).toEqual({
        errorMessage: "External API failure",
        errorType: "CallbackError",
        stackTrace: expect.any(Array),
      });
    });
  },
});
