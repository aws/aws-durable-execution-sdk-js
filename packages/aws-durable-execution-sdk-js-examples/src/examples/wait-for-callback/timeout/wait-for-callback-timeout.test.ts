import { InvocationType } from "@aws-sdk/client-lambda";
import { handler } from "./wait-for-callback-timeout";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should handle waitForCallback timeout scenarios", async () => {
      const result = await runner.run({
        payload: { test: "timeout-scenario" },
      });

      expect(result.getError()).toEqual({
        errorData: undefined,
        errorMessage: "Callback timed out",
        errorType: "CallbackTimeoutError",
        stackTrace: undefined,
      });

      assertEventSignatures(result);
    });
  },
});
