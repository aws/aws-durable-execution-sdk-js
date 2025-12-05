import { handler } from "./map-failure-threshold-exceeded-percentage";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Map failure threshold exceeded percentage",
  functionName: "map-failure-threshold-exceeded-percentage",
  handler,
  localRunnerConfig: {
    skipTime: false,
  },
  tests: (runner) => {
    it("should return FAILURE_TOLERANCE_EXCEEDED when failure percentage exceeds threshold", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
      expect(result.successCount).toBe(2); // Items 4 and 5 succeed
      expect(result.failureCount).toBe(3); // Items 1, 2, 3 fail (60% > 50% threshold)
      expect(result.totalCount).toBe(5);

      // Get the map context result from history
      const historyEvents = execution.getHistoryEvents();
      const mapContext = historyEvents.find(
        (event) =>
          event.EventType === "ContextSucceeded" &&
          event.Name === "failure-threshold-items",
      );

      expect(mapContext).toBeDefined();
      expect(
        mapContext?.ContextSucceededDetails?.Result?.Payload,
      ).toBeDefined();
      const mapResult = JSON.parse(
        mapContext!.ContextSucceededDetails!.Result!.Payload!,
      );

      // Verify individual results
      expect(mapResult.all).toHaveLength(5);

      // Items 0, 1, 2 should fail
      expect(mapResult.all[0].status).toBe("FAILED");
      expect(mapResult.all[0].index).toBe(0);
      expect(mapResult.all[0].error.errorType).toBe("ChildContextError");

      expect(mapResult.all[1].status).toBe("FAILED");
      expect(mapResult.all[1].index).toBe(1);
      expect(mapResult.all[1].error.errorType).toBe("ChildContextError");

      expect(mapResult.all[2].status).toBe("FAILED");
      expect(mapResult.all[2].index).toBe(2);
      expect(mapResult.all[2].error.errorType).toBe("ChildContextError");

      // Items 3, 4 should succeed
      expect(mapResult.all[3].status).toBe("SUCCEEDED");
      expect(mapResult.all[3].index).toBe(3);
      expect(mapResult.all[3].result).toBe(8); // 4 * 2

      expect(mapResult.all[4].status).toBe("SUCCEEDED");
      expect(mapResult.all[4].index).toBe(4);
      expect(mapResult.all[4].result).toBe(10); // 5 * 2
    }, 15000); // 15 second timeout to accommodate retry delays
  },
});
