import { handler } from "./dag-runif";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should run only the branch whose runIf predicate matches", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toEqual({
        completionReason: "ALL_COMPLETED",
        classify: "safe",
        publish: "published",
        publishStatus: "SUCCEEDED",
        reviewStatus: "SKIPPED",
        blockedStatus: "SKIPPED",
        successCount: 2,
        skippedCount: 2,
      });

      assertEventSignatures(execution);
    });
  },
});
