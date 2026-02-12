import { handler } from "./error-instance";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should catch CallbackTimeoutError instance", async () => {
      const result = await runner.run({
        payload: {},
      });

      const errorCheck = result.getResult();

      expect(errorCheck).toEqual({
        isCallbackTimeoutError: true,
        errorName: "CallbackTimeoutError",
        errorMessage: "Callback timed out",
      });

      assertEventSignatures(result);
    });
  },
});
