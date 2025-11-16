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

      // Assert that duration is approximately 1 second, not 3 seconds
      expect(duration).toBeGreaterThanOrEqual(1000);
      expect(duration).toBeLessThan(1500);

      // Get the wait operations to verify they were created
      const wait1SecondOp = runner.getOperation("wait-1-second");
      const wait3SecondsOp = runner.getOperation("wait-3-seconds");
      const wait3SecondsOp2 = runner.getOperation("wait-3-seconds-2");

      // Verify the wait durations are correct
      expect(wait1SecondOp.getWaitDetails()?.waitSeconds).toBe(1);
      expect(wait3SecondsOp.getWaitDetails()?.waitSeconds).toBe(3);
      expect(wait3SecondsOp2.getWaitDetails()?.waitSeconds).toBe(3);
    });
  },
});
