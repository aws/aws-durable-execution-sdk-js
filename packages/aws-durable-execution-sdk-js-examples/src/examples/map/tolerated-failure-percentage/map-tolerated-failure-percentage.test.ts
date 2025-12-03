import { handler } from "./map-tolerated-failure-percentage";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Map toleratedFailurePercentage",
  functionName: "map-tolerated-failure-percentage",
  handler,
  tests: (runner) => {
    it("should complete with acceptable failure percentage", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Assert overall results
      expect(result.failureCount).toBe(3);
      expect(result.successCount).toBe(7);
      expect(result.failurePercentage).toBe(30);
      expect(result.completionReason).toBe("ALL_COMPLETED");
      expect(result.totalCount).toBe(10);

      // Get the map operation from history to verify individual item results
      const historyEvents = execution.getHistoryEvents();
      const mapContext = historyEvents.find(
        (event) =>
          event.EventType === "ContextSucceeded" &&
          event.Name === "failure-percentage-items",
      );

      expect(mapContext).toBeDefined();
      const mapResult = JSON.parse(
        mapContext!.ContextSucceededDetails!.Result!.Payload!,
      );

      // Assert individual item results
      expect(mapResult.all).toHaveLength(10);

      // Items 1, 2, 4, 5, 7, 8, 10 should succeed (not divisible by 3)
      const expectedSuccesses = [0, 1, 3, 4, 6, 7, 9]; // indices for items 1,2,4,5,7,8,10
      const expectedFailures = [2, 5, 8]; // indices for items 3,6,9

      expectedSuccesses.forEach((index) => {
        expect(mapResult.all[index].status).toBe("SUCCEEDED");
        expect(mapResult.all[index].result).toBe(`Item ${index + 1} processed`);
        expect(mapResult.all[index].index).toBe(index);
      });

      expectedFailures.forEach((index) => {
        expect(mapResult.all[index].status).toBe("FAILED");
        expect(mapResult.all[index].error).toBeDefined();
        expect(mapResult.all[index].index).toBe(index);
      });
    });
  },
});
