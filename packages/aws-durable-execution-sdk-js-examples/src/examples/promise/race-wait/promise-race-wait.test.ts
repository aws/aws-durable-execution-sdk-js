import { handler } from "./promise-race-wait";
import { createTests } from "../../../utils/test-helper";

createTests({
  localRunnerConfig: {
    skipTime: false,
  },
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should complete all waits and wait for smallest duration", async () => {
      const execution = await runner.run();

      const wait1Op = runner.getOperation("wait-1");
      const wait2Op = runner.getOperation("wait-2");

      expect(execution.getResult()).toBeGreaterThan(1000);
      expect(execution.getResult()).toBeLessThan(9000);

      expect(execution.getOperations()).toHaveLength(5);

      expect(wait1Op.getWaitDetails()!.waitSeconds!).toBe(1);
      expect(wait2Op.getWaitDetails()!.waitSeconds!).toBe(10);

      assertEventSignatures(execution);
    });
  },
});
