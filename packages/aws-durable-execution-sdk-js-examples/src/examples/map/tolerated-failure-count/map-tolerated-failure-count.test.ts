import { handler } from "./map-tolerated-failure-count";
import { createTests } from "../../../utils/test-helper";
import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
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
      [
        { name: "process-0", status: OperationStatus.SUCCEEDED },
        { name: "process-1", status: OperationStatus.FAILED },
        { name: "process-2", status: OperationStatus.SUCCEEDED },
        { name: "process-3", status: OperationStatus.FAILED },
        { name: "process-4", status: OperationStatus.SUCCEEDED },
      ].forEach(({ name, status }) => {
        expect(runner.getOperation(name)?.getStatus()).toBe(status);
      });
    });
  },
});
