import { handler } from "./parallel-tolerated-failure-percentage";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Parallel toleratedFailurePercentage",
  functionName: "parallel-tolerated-failure-percentage",
  handler,
  tests: (runner) => {
    it("should complete with acceptable failure percentage", async () => {
      const execution = await runner.run();

      const result = execution.getResult() as any;

      // Assert overall results
      expect(result.failureCount).toBe(2);
      expect(result.successCount).toBe(3);
      expect(result.failurePercentage).toBe(40);
      expect(result.completionReason).toBe("ALL_COMPLETED");
      expect(result.totalCount).toBe(5);

      // Get the parallel operation from history to verify individual branch results
      const historyEvents = execution.getHistoryEvents();
      const parallelContext = historyEvents.find(
        (event) =>
          event.EventType === "ContextSucceeded" &&
          event.Name === "failure-percentage-branches",
      );

      expect(parallelContext).toBeDefined();
      const parallelResult = JSON.parse(
        parallelContext!.ContextSucceededDetails!.Result!.Payload!,
      );

      // Assert individual branch results
      expect(parallelResult.all).toHaveLength(5);

      // Branch 1 should succeed
      expect(parallelResult.all[0].status).toBe("SUCCEEDED");
      expect(parallelResult.all[0].result).toBe("Branch 1 success");
      expect(parallelResult.all[0].index).toBe(0);

      // Branch 2 should fail
      expect(parallelResult.all[1].status).toBe("FAILED");
      expect(parallelResult.all[1].error).toBeDefined();
      expect(parallelResult.all[1].index).toBe(1);

      // Branch 3 should succeed
      expect(parallelResult.all[2].status).toBe("SUCCEEDED");
      expect(parallelResult.all[2].result).toBe("Branch 3 success");
      expect(parallelResult.all[2].index).toBe(2);

      // Branch 4 should fail
      expect(parallelResult.all[3].status).toBe("FAILED");
      expect(parallelResult.all[3].error).toBeDefined();
      expect(parallelResult.all[3].index).toBe(3);

      // Branch 5 should succeed
      expect(parallelResult.all[4].status).toBe("SUCCEEDED");
      expect(parallelResult.all[4].result).toBe("Branch 5 success");
      expect(parallelResult.all[4].index).toBe(4);
    });
  },
});
