import { InvocationType } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./create-callback-timeout-classification";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  // Real timers so the 1s callback timeout actually elapses during the longer
  // in-invocation step, and the timeout is classified by createCallbackPromise
  // on the same invocation rather than on a later replay.
  localRunnerConfig: { skipTime: false },
  tests: (runner, { assertEventSignatures, isCloud }) => {
    it("rejects an unanswered callback with a CallbackTimeoutError", async () => {
      const execution = await runner.run();

      expect(execution.getResult()).toEqual({
        approved: false,
        timedOut: true,
        isCallbackError: true,
        isTimeoutError: true,
        errorType: "CallbackTimeoutError",
        message: "Callback timed out",
      });

      // One invocation means the timeout was classified in-invocation by
      // createCallbackPromise (no replay through the already-completed path).
      if (!isCloud) {
        expect(execution.getInvocations().length).toBe(1);
      }

      assertEventSignatures(execution);
    });
  },
});
