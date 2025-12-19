import { InvocationType } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-for-callback-failing-submitter";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should handle waitForCallback with failing submitter function errors", async () => {
      const execution = await runner.run();

      expect(execution.getResult()).toEqual({
        success: false,
        error: "Submitter failed",
      });

      assertEventSignatures(execution);
    });
  },
});
