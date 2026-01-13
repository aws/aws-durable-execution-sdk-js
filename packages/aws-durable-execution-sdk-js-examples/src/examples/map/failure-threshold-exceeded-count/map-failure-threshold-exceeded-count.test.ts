import { handler } from "./map-failure-threshold-exceeded-count";
import { createTests } from "../../../utils/test-helper";
import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should return FAILURE_TOLERANCE_EXCEEDED when failure count exceeds threshold", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
      expect(result.successCount).toBe(2); // Items 4 and 5 succeed
      expect(result.failureCount).toBe(3); // Items 1, 2, 3 fail (exceeds threshold of 2)
      expect(result.totalCount).toBe(5);

      // Verify individual operation statuses
      [
        { name: "process-0", status: OperationStatus.FAILED },
        { name: "process-1", status: OperationStatus.FAILED },
        { name: "process-2", status: OperationStatus.FAILED },
        { name: "process-3", status: OperationStatus.SUCCEEDED },
        { name: "process-4", status: OperationStatus.SUCCEEDED },
      ].forEach(({ name, status }) => {
        expect(runner.getOperation(name)?.getStatus()).toBe(status);
      });

      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 1,
      });
    });
  },
});
