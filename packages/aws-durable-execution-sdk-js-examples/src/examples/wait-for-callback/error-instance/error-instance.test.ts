import { handler } from "./error-instance";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should catch correct error instances for timeout and submitter", async () => {
      const result = await runner.run({ payload: {} });
      const errorCheck = result.getResult();

      expect(errorCheck).toEqual({
        timeoutError: {
          isCallbackTimeoutError: true,
          errorName: "CallbackTimeoutError",
          errorMessage: "Callback timed out",
        },
        failureError: {
          isCallbackTimeoutError: true,
          errorName: "CallbackTimeoutError",
          errorMessage: "Callback timed out",
        },
        submitterError: {
          isCallbackSubmitterError: true,
          errorName: "CallbackSubmitterError",
          errorMessage: "Submitter failed",
        },
      });

      assertEventSignatures(result);
    });
  },
});
