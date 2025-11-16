import { handler } from "./promise-race-timing";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "promise-race-timing",
  functionName: "promise-race-timing",
  handler,
  localRunnerConfig: {
    skipTime: false,
  },
  tests: (runner) => {
    it("should race correctly and complete in approximately 1 second", async () => {
      const execution = await runner.run();
      const duration = execution.getResult() as number;

      // Assert that duration is between 1 and 5 seconds
      expect(duration).toBeGreaterThanOrEqual(1000);
      expect(duration).toBeLessThan(5000);

      // Get the wait operations to verify they were created
      const wait1SecondOp = runner.getOperation("wait-1-second");
      const wait5SecondsOp = runner.getOperation("wait-5-seconds");
      const wait5SecondsOp2 = runner.getOperation("wait-5-seconds-2");

      // Verify the wait durations are correct
      expect(wait1SecondOp.getWaitDetails()?.waitSeconds).toBe(1);
      expect(wait5SecondsOp.getWaitDetails()?.waitSeconds).toBe(5);
      expect(wait5SecondsOp2.getWaitDetails()?.waitSeconds).toBe(5);
    });
  },
});
