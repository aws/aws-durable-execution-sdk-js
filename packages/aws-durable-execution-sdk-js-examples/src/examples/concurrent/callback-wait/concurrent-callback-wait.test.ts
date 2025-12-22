import { InvocationType } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./concurrent-callback-wait";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  localRunnerConfig: {
    skipTime: false,
  },
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should complete execution after both wait and callback complete", async () => {
      const executionPromise = runner.run();
      const callback = runner.getOperation("callback");

      await callback.waitForData();

      // Wait should be resolved after this
      await new Promise((resolve) => setTimeout(resolve, 2000));

      await callback.sendCallbackSuccess();

      const result = await executionPromise;

      expect(result.getResult()).toBeGreaterThan(1000);
      expect(result.getResult()).toBeLessThan(6000);

      expect(runner.getOperation("wait").getWaitDetails()?.waitSeconds).toBe(1);

      assertEventSignatures(result);
    });
  },
});
