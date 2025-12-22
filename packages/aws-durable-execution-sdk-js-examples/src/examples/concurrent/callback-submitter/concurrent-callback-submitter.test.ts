import { InvocationType } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./concurrent-callback-submitter";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should handle multiple concurrent waitForCallback operations", async () => {
      const callback1Op = runner.getOperation("wait-for-callback-1");
      const callback2Op = runner.getOperation("wait-for-callback-2");

      const executionPromise = runner.run();

      await Promise.all([callback1Op.waitForData(), callback2Op.waitForData()]);

      const callback2Result = JSON.stringify({
        id: 2,
        data: "second-completed",
      });
      const callback1Result = JSON.stringify({
        id: 1,
        data: "first-completed",
      });

      // Ensure invocation completes
      await new Promise((resolve) => setTimeout(resolve, 100));

      await callback2Op.sendCallbackSuccess(callback2Result);
      await callback1Op.sendCallbackSuccess(callback1Result);

      const execution = await executionPromise;

      assertEventSignatures(execution);
    });
  },
});
