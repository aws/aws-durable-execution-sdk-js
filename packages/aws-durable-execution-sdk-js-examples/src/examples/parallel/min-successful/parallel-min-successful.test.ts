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

      // Assert individual branch results - includes all started branches (2 completed + 2 started)
      expect(parallelResult.all).toHaveLength(4);

      // First two branches should succeed (branch-1 and branch-2 complete fastest)
      expect(parallelResult.all[0].status).toBe("SUCCEEDED");
      expect(parallelResult.all[0].result).toBe("Branch 1 result");
      expect(parallelResult.all[0].index).toBe(0);

      expect(parallelResult.all[1].status).toBe("SUCCEEDED");
      expect(parallelResult.all[1].result).toBe("Branch 2 result");
      expect(parallelResult.all[1].index).toBe(1);

      // Remaining branches should be in STARTED state (not completed)
      expect(parallelResult.all[2].status).toBe("STARTED");
      expect(parallelResult.all[2].index).toBe(2);

      expect(parallelResult.all[3].status).toBe("STARTED");
      expect(parallelResult.all[3].index).toBe(3);

      // Verify the results array matches
      expect(result.results).toEqual(["Branch 1 result", "Branch 2 result"]);
    });
  },
});
