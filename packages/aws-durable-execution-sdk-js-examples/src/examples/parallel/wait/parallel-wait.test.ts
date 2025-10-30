import { handler } from "./parallel-wait";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "parallel-wait test",
  functionName: "parallel-wait",
  localRunnerConfig: {
    skipTime: false,
  },
  handler,
  tests: (runner) => {
    it("should complete all waits and wait for max duration", async () => {
      const execution = await runner.run();

      const parentBlockOp = runner.getOperation("parent-block");
      const wait1SecondOp = runner.getOperation("wait-1-second");
      const wait2SecondsOp = runner.getOperation("wait-2-seconds");
      const wait5SecondsOp = runner.getOperation("wait-5-seconds");

      expect(execution.getResult()).toBe("Completed waits");
      expect(execution.getOperations()).toHaveLength(7);

      expect(parentBlockOp.getChildOperations()).toHaveLength(3);

      expect(wait1SecondOp.getWaitDetails()!.waitSeconds!).toBe(1);
      expect(wait2SecondsOp.getWaitDetails()!.waitSeconds!).toBe(2);
      expect(wait5SecondsOp.getWaitDetails()!.waitSeconds!).toBe(5);
    }, 10000);
  },
});
