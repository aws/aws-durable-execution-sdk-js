import { handler } from "./map-min-successful";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Map minSuccessful",
  functionName: "map-min-successful",
  handler,
  tests: (runner) => {
    it("should complete early when minSuccessful is reached", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Assert overall results
      expect(result.successCount).toBe(2);
      expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
      expect(result.results).toHaveLength(2);
      expect(result.totalCount).toBe(5);

      // Get the map operation from history to verify individual item results
      const historyEvents = execution.getHistoryEvents();
      const mapContext = historyEvents.find(
        (event) =>
          event.EventType === "ContextSucceeded" &&
          event.Name === "min-successful-items",
      );

      expect(mapContext).toBeDefined();
      const mapResult = JSON.parse(
        mapContext!.ContextSucceededDetails!.Result!.Payload!,
      );

      // Assert individual item results - includes all started items (2 completed + 3 started)
      expect(mapResult.all).toHaveLength(5);

      // First two items should succeed (items 1 and 2 process fastest due to timeout)
      expect(mapResult.all[0].status).toBe("SUCCEEDED");
      expect(mapResult.all[0].result).toBe("Item 1 processed");
      expect(mapResult.all[0].index).toBe(0);

      expect(mapResult.all[1].status).toBe("SUCCEEDED");
      expect(mapResult.all[1].result).toBe("Item 2 processed");
      expect(mapResult.all[1].index).toBe(1);

      // Remaining items should be in STARTED state (not completed)
      expect(mapResult.all[2].status).toBe("STARTED");
      expect(mapResult.all[2].index).toBe(2);

      expect(mapResult.all[3].status).toBe("STARTED");
      expect(mapResult.all[3].index).toBe(3);

      expect(mapResult.all[4].status).toBe("STARTED");
      expect(mapResult.all[4].index).toBe(4);

      // Verify the results array matches
      expect(result.results).toEqual(["Item 1 processed", "Item 2 processed"]);
    });
  },
});
