import { handler } from "./map-failure-threshold-exceeded-count";
import { createTests } from "../../../utils/test-helper";
import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  name: "Map failure threshold exceeded count",
  functionName: "map-failure-threshold-exceeded-count",
  handler,
  tests: (runner) => {
    it("should return FAILURE_TOLERANCE_EXCEEDED when failure count exceeds threshold", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
      expect(result.successCount).toBe(2); // Items 4 and 5 succeed
      expect(result.failureCount).toBe(3); // Items 1, 2, 3 fail (exceeds threshold of 2)
      expect(result.totalCount).toBe(5);

      // Verify individual operation statuses
      const item0 = runner.getOperation("process-0");
      expect(item0?.getStatus()).toBe(OperationStatus.FAILED);

      const item1 = runner.getOperation("process-1");
      expect(item1?.getStatus()).toBe(OperationStatus.FAILED);

      const item2 = runner.getOperation("process-2");
      expect(item2?.getStatus()).toBe(OperationStatus.FAILED);

      const item3 = runner.getOperation("process-3");
      expect(item3?.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const item4 = runner.getOperation("process-4");
      expect(item4?.getStatus()).toBe(OperationStatus.SUCCEEDED);
    });
  },
});
