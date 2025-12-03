import { handler } from "./map-failure-threshold-exceeded-count";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Map failure threshold exceeded count",
  functionName: "map-failure-threshold-exceeded-count",
  handler,
  tests: (runner) => {
    it("should return FAILURE_TOLERANCE_EXCEEDED when failure count exceeds threshold", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Assert overall results
      expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
      expect(result.successCount).toBe(2); // Items 4 and 5 succeed
      expect(result.failureCount).toBe(3); // Items 1, 2, 3 fail (exceeds threshold of 2)
      expect(result.totalCount).toBe(5);

      // Get the map operation from history to verify individual item results
      const historyEvents = execution.getHistoryEvents();
      const mapContext = historyEvents.find(
        (event) =>
          event.EventType === "ContextFailed" &&
          event.Name === "failure-threshold-items",
      );

      expect(mapContext).toBeDefined();
      const mapResult = JSON.parse(
        mapContext!.ContextFailedDetails!.Error!.Payload!,
      );

      // Assert individual item results
      expect(mapResult.all).toHaveLength(5);

      // Items 1, 2, 3 should fail (indices 0, 1, 2)
      expect(mapResult.all[0].status).toBe("FAILED");
      expect(mapResult.all[0].error).toBeDefined();
      expect(mapResult.all[0].index).toBe(0);

      expect(mapResult.all[1].status).toBe("FAILED");
      expect(mapResult.all[1].error).toBeDefined();
      expect(mapResult.all[1].index).toBe(1);

      expect(mapResult.all[2].status).toBe("FAILED");
      expect(mapResult.all[2].error).toBeDefined();
      expect(mapResult.all[2].index).toBe(2);

      // Items 4, 5 should succeed (indices 3, 4)
      expect(mapResult.all[3].status).toBe("SUCCEEDED");
      expect(mapResult.all[3].result).toBe(8); // 4 * 2
      expect(mapResult.all[3].index).toBe(3);

      expect(mapResult.all[4].status).toBe("SUCCEEDED");
      expect(mapResult.all[4].result).toBe(10); // 5 * 2
      expect(mapResult.all[4].index).toBe(4);
    });
  },
});
