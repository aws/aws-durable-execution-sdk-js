import { InvocationType } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-for-callback-failing-submitter";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    // Pending resolution of https://github.com/aws/aws-durable-execution-sdk-js/issues/199
    it.skip("should handle waitForCallback with failing submitter function errors", async () => {
      const execution = await runner.run();

      expect(execution.getResult()).toEqual({
        success: false,
        error: "Submitter failed",
      });
    });
  },
});
