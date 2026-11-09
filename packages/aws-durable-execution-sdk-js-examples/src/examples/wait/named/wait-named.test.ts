import { handler } from "./wait-named";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should call wait for 5 seconds", async () => {
      const execution = await runner.run();
      const waitOp = runner.getOperation("wait-2-seconds");

      expect(execution.getResult()).toBe("wait finished");
      expect(waitOp.getWaitDetails()?.waitSeconds).toEqual(2);

      // The cloud poller stops at ExecutionSucceeded, which the service can
      // record before the final InvocationCompleted, so allow it to be missing.
      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 1,
      });
    });
  },
});
