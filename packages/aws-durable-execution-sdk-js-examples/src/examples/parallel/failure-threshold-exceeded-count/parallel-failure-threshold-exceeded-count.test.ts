import { handler } from "./parallel-failure-threshold-exceeded-count";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Parallel failure threshold exceeded count",
  functionName: "parallel-failure-threshold-exceeded-count",
  handler,
  tests: (runner) => {
    it("should return FAILURE_TOLERANCE_EXCEEDED when failure count exceeds threshold", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Assert overall results
      expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
      expect(result.successCount).toBe(2); // Tasks 4 and 5 succeed
      expect(result.failureCount).toBe(3); // Tasks 1, 2, 3 fail (exceeds threshold of 2)
      expect(result.totalCount).toBe(5);

      // Get the parallel operation from history to verify individual branch results
      const historyEvents = execution.getHistoryEvents();
      const parallelContext = historyEvents.find(
        (event) =>
          event.EventType === "ContextFailed" &&
          event.Name === "failure-threshold-tasks",
      );

      expect(parallelContext).toBeDefined();
      const parallelResult = JSON.parse(
        parallelContext!.ContextFailedDetails!.Error!.Payload!,
      );

      // Assert individual branch results
      expect(parallelResult.all).toHaveLength(5);

      // Tasks 1, 2, 3 should fail (indices 0, 1, 2)
      expect(parallelResult.all[0].status).toBe("FAILED");
      expect(parallelResult.all[0].error).toBeDefined();
      expect(parallelResult.all[0].index).toBe(0);

      expect(parallelResult.all[1].status).toBe("FAILED");
      expect(parallelResult.all[1].error).toBeDefined();
      expect(parallelResult.all[1].index).toBe(1);

      expect(parallelResult.all[2].status).toBe("FAILED");
      expect(parallelResult.all[2].error).toBeDefined();
      expect(parallelResult.all[2].index).toBe(2);

      // Tasks 4, 5 should succeed (indices 3, 4)
      expect(parallelResult.all[3].status).toBe("SUCCEEDED");
      expect(parallelResult.all[3].result).toBe("Task 4 success");
      expect(parallelResult.all[3].index).toBe(3);

      expect(parallelResult.all[4].status).toBe("SUCCEEDED");
      expect(parallelResult.all[4].result).toBe("Task 5 success");
      expect(parallelResult.all[4].index).toBe(4);
    });
  },
});
