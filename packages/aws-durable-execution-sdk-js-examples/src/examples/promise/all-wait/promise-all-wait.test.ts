import { handler } from "./promise-all-wait";
import historyEvents from "./promise-all-wait.history.json";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "promise-all-wait test",
  functionName: "promise-all-wait",
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

      expect(execution.getResult()).toEqual([null, null, null]);
      expect(execution.getOperations()).toHaveLength(4);

      expect(wait1Op.getWaitDetails()!.waitSeconds!).toBe(1);
      expect(wait2Op.getWaitDetails()!.waitSeconds!).toBe(2);
      expect(wait3Op.getStepDetails()!.result).toBeUndefined();

      assertEventSignatures(execution.getHistoryEvents(), historyEvents);
    }, 10000);
  },
});
