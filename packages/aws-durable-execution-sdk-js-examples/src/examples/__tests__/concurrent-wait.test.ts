import { handler } from "../concurrent-wait";
import { createTests } from "./shared/test-helper";

createTests({
  name: "concurrent-wait test",
  functionName: "concurrent-wait",
  localRunnerConfig: {
    skipTime: false,
  },
  handler,
  tests: (runner) => {
    it("should complete all waits and wait for the max duration", async () => {
      const execution = await runner.run();

      const wait1SecondOp = runner.getOperation("wait-1-second");
      const wait5SecondsOp = runner.getOperation("wait-5-seconds");
      const wait10SecondsOp = runner.getOperation("wait-10-seconds");

      expect(execution.getResult()).toBe("Completed waits");
      expect(execution.getOperations()).toHaveLength(3);

      expect(wait1SecondOp.getWaitDetails()!.waitSeconds!).toBe(1);
      expect(wait5SecondsOp.getWaitDetails()!.waitSeconds!).toBe(5);
      expect(wait10SecondsOp.getWaitDetails()!.waitSeconds!).toBe(10);
    }, 30000);
  },
});
