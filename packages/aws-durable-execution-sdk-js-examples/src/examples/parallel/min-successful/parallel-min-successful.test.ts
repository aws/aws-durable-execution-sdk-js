import { handler } from "./parallel-min-successful";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Parallel minSuccessful",
  functionName: "parallel-min-successful",
  handler,
  tests: (runner) => {
    it("should complete early when minSuccessful is reached", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Assert overall results
      expect(result.successCount).toBe(2);
      expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
      expect(result.results).toHaveLength(2);
      expect(result.totalCount).toBe(4);

      // Get the parallel operation from history to verify individual branch results
      const historyEvents = execution.getHistoryEvents();
      const parallelContext = historyEvents.find(
        (event) =>
          event.EventType === "ContextSucceeded" &&
          event.Name === "min-successful-branches",
      );

      expect(parallelContext).toBeDefined();
      const parallelResult = JSON.parse(
        parallelContext!.ContextSucceededDetails!.Result!.Payload!,
      );

      // Assert individual branch results - should have exactly 2 completed branches
      expect(parallelResult.all).toHaveLength(2);

      // First two branches should succeed (branch-1 and branch-2 complete fastest)
      expect(parallelResult.all[0].status).toBe("SUCCEEDED");
      expect(parallelResult.all[0].result).toBe("Branch 1 result");
      expect(parallelResult.all[0].index).toBe(0);

      expect(parallelResult.all[1].status).toBe("SUCCEEDED");
      expect(parallelResult.all[1].result).toBe("Branch 2 result");
      expect(parallelResult.all[1].index).toBe(1);

      // Verify the results array matches
      expect(result.results).toEqual(["Branch 1 result", "Branch 2 result"]);
    });
  },
});
