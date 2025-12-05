import { handler } from "./map-tolerated-failure-percentage";
import { createTests } from "../../../utils/test-helper";
import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";

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

      // Verify individual operation statuses (items 3, 6, 9 fail; others succeed)
      const item0 = runner.getOperation("process-0");
      expect(item0?.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const item1 = runner.getOperation("process-1");
      expect(item1?.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const item2 = runner.getOperation("process-2");
      expect(item2?.getStatus()).toBe(OperationStatus.FAILED);

      const item3 = runner.getOperation("process-3");
      expect(item3?.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const item4 = runner.getOperation("process-4");
      expect(item4?.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const item5 = runner.getOperation("process-5");
      expect(item5?.getStatus()).toBe(OperationStatus.FAILED);
    });
  },
});
