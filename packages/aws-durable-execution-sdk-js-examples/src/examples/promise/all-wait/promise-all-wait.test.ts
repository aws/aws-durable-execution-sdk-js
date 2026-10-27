import { handler } from "./promise-all-wait";
import { createTests } from "../../../utils/test-helper";
import { EventType } from "@aws-sdk/client-lambda";

createTests({
  localRunnerConfig: {
    skipTime: false,
  },
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should complete all waits and wait for max duration", async () => {
      const execution = await runner.run();

      const wait1Op = runner.getOperation("wait-1");
      const wait2Op = runner.getOperation("wait-2");
      const wait3Op = runner.getOperation("wait-3");

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toEqual([null, null, null]);
      expect(execution.getOperations()).toHaveLength(4);

      for (const operation of [wait1Op, wait2Op, wait3Op]) {
        expect(operation.getStatus()).toBe("SUCCEEDED");
      }

      expect(wait1Op.getWaitDetails()!.waitSeconds!).toBe(1);
      expect(wait2Op.getWaitDetails()!.waitSeconds!).toBe(2);
      expect(wait3Op.getStepDetails()!.result).toBeUndefined();

      // Each wait can complete while the initial invocation is active or wake
      // the execution after suspension. The backend need not deliver both
      // completions before the three-second step ends: one initial invocation
      // plus at most one resume per independent wait is a valid history.
      const invocationCount = execution
        .getHistoryEvents()
        .filter(
          (event) => event.EventType === EventType.InvocationCompleted,
        ).length;
      expect(invocationCount).toBeGreaterThanOrEqual(1);
      expect(invocationCount).toBeLessThanOrEqual(3);

      assertEventSignatures(execution, undefined, {
        // The fixture coalesces both wait completions into its one invocation.
        // All step, wait, context and execution event counts remain exact.
        invocationCompletedDifference: 2,
      });
    }, 10000);
  },
});
