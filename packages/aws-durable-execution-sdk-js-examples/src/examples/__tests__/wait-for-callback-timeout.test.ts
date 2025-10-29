import { InvocationType } from "@aws-sdk/client-lambda";
import { handler } from "../wait-for-callback-timeout";
import { createTests } from "./shared/test-helper";

createTests({
  name: "wait-for-callback-timeout test",
  functionName: "wait-for-callback-timeout",
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    it("should handle waitForCallback timeout scenarios", async () => {
      const result = await runner.run({
        payload: { test: "timeout-scenario" },
      });

      expect(result.getResult()).toEqual({
        success: false,
        error: "Callback failed",
      });
    });
  },
});
