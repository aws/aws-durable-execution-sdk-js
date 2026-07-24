import { handler } from "./dag-wait-resume";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should suspend on a wait task and resume the DAG across replay", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toEqual({
        completionReason: "ALL_COMPLETED",
        prepare: "prepared",
        pauseStatus: "SUCCEEDED",
        finalize: "finalized",
        successCount: 3,
        totalCount: 3,
      });

      // The wait forces at least one suspend/resume: the execution is invoked
      // more than once (initial run + resume after the wait elapses).
      expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);

      assertEventSignatures(execution);
    });
  },
});
