import { handler } from "./map-tolerated-failure-count";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Map toleratedFailureCount",
  functionName: "map-tolerated-failure-count",
  handler,
  tests: (runner) => {
    it("should complete when failure tolerance is reached", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Assert overall results
      expect(result.failureCount).toBe(2);
      expect(result.successCount).toBe(3);
      expect(result.completionReason).toBe("ALL_COMPLETED");
      expect(result.hasFailure).toBe(true);
      expect(result.totalCount).toBe(5);

      // Get the map operation from history to verify individual item results
      const historyEvents = execution.getHistoryEvents();
      const mapContext = historyEvents.find(
        (event) =>
          event.EventType === "ContextSucceeded" &&
          event.Name === "failure-count-items",
      );

      expect(mapContext).toBeDefined();
      const mapResult = JSON.parse(
        mapContext!.ContextSucceededDetails!.Result!.Payload!,
      );

      // Assert individual item results
      expect(mapResult.all).toHaveLength(5);

      // Item 1 should succeed (index 0)
      expect(mapResult.all[0].status).toBe("SUCCEEDED");
      expect(mapResult.all[0].result).toBe("Item 1 processed");
      expect(mapResult.all[0].index).toBe(0);

      // Item 2 should fail (index 1)
      expect(mapResult.all[1].status).toBe("FAILED");
      expect(mapResult.all[1].error).toBeDefined();
      expect(mapResult.all[1].index).toBe(1);

      // Item 3 should succeed (index 2)
      expect(mapResult.all[2].status).toBe("SUCCEEDED");
      expect(mapResult.all[2].result).toBe("Item 3 processed");
      expect(mapResult.all[2].index).toBe(2);

      // Item 4 should fail (index 3)
      expect(mapResult.all[3].status).toBe("FAILED");
      expect(mapResult.all[3].error).toBeDefined();
      expect(mapResult.all[3].index).toBe(3);

      // Item 5 should succeed (index 4)
      expect(mapResult.all[4].status).toBe("SUCCEEDED");
      expect(mapResult.all[4].result).toBe("Item 5 processed");
      expect(mapResult.all[4].index).toBe(4);
    });
  },
});
