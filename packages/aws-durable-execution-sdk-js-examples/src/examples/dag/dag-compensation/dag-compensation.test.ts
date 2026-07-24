import { handler } from "./dag-compensation";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should run compensation via trigger rules when charge fails", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toEqual({
        completionReason: "COMPLETED_WITH_FAILURES",
        chargeStatus: "FAILED",
        fulfillStatus: "SKIPPED",
        refundStatus: "SUCCEEDED",
        refund: "refunded",
        auditStatus: "SUCCEEDED",
        audit: "audited",
        successCount: 2,
        failureCount: 1,
        skippedCount: 1,
      });

      assertEventSignatures(execution);
    });
  },
});
