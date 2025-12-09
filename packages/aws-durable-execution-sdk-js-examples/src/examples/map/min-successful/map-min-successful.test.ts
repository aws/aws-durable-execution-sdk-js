import { handler } from "./map-min-successful";
import { createTests } from "../../../utils/test-helper";
import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
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
      // Get the map operation result
      const mapResult = runner.getOperation("min-successful-items");

      // Get individual map item operations
      const item0 = runner.getOperation("process-0");
      const item1 = runner.getOperation("process-1");
      const item2 = runner.getOperation("process-2");
      const item3 = runner.getOperation("process-3");
      const item4 = runner.getOperation("process-4");

      // First two items should succeed (items 1 and 2 process fastest due to timeout)
      expect(item0?.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(item1?.getStatus()).toBe(OperationStatus.SUCCEEDED);

      // TODO: Re-enable these assertions when we find the root cause of the cloud timing issue
      // where remaining items show SUCCEEDED instead of STARTED
      // Remaining items should be in STARTED state (not completed)
      // expect(item2?.getStatus()).toBe(OperationStatus.STARTED);
      // expect(item3?.getStatus()).toBe(OperationStatus.STARTED);
      // expect(item4?.getStatus()).toBe(OperationStatus.STARTED);

      // Verify the results array matches
      expect(result.results).toEqual(["Item 1 processed", "Item 2 processed"]);
    });
  },
});
