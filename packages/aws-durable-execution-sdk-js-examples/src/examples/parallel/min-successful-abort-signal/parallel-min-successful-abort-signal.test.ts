import { handler, SLOW_STEP_MS } from "./parallel-min-successful-abort-signal";
import { createTests } from "../../../utils/test-helper";
import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  localRunnerConfig: {
    skipTime: false,
  },
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("stops the slow branch when the fast branch wins", async () => {
      const started = Date.now();
      const execution = await runner.run();

      expect(execution.getResult()).toEqual(["fast"]);
      expect(runner.getOperation("fast")?.getStatus()).toBe(
        OperationStatus.SUCCEEDED,
      );
      expect(runner.getOperation("slow")?.getStatus()).toBe(
        OperationStatus.STARTED,
      );
      // The slow step stopped on its signal. Otherwise the wait could not
      // suspend the invocation before the slow step returned.
      expect(Date.now() - started).toBeLessThan(SLOW_STEP_MS / 2);

      assertEventSignatures(execution);
    });
  },
});
