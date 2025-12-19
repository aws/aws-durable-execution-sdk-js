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

      // TODO: Align testing library timeout error messages with cloud behavior
      // Cloud returns "Callback timed out", local returns "Callback failed"
      expect(result.getResult()).toEqual({
        success: false,
        error: expect.any(String),
      });

      assertEventSignatures(result);
    });
  },
});
