import { handler } from "./map-tolerated-failure-count";
import { createTests } from "../../../utils/test-helper";
import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";

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

      // Verify individual operation statuses
      const item0 = runner.getOperation("process-0");
      expect(item0?.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const item1 = runner.getOperation("process-1");
      expect(item1?.getStatus()).toBe(OperationStatus.FAILED);

      const item2 = runner.getOperation("process-2");
      expect(item2?.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const item3 = runner.getOperation("process-3");
      expect(item3?.getStatus()).toBe(OperationStatus.FAILED);

      const item4 = runner.getOperation("process-4");
      expect(item4?.getStatus()).toBe(OperationStatus.SUCCEEDED);
    });
  },
});
