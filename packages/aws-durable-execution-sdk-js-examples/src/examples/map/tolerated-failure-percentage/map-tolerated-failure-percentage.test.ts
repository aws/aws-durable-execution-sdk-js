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
      [
        { name: "process-0", status: OperationStatus.SUCCEEDED },
        { name: "process-1", status: OperationStatus.SUCCEEDED },
        { name: "process-2", status: OperationStatus.FAILED },
        { name: "process-3", status: OperationStatus.SUCCEEDED },
        { name: "process-4", status: OperationStatus.SUCCEEDED },
        { name: "process-5", status: OperationStatus.FAILED },
      ].forEach(({ name, status }) => {
        expect(runner.getOperation(name)?.getStatus()).toBe(status);
      });
    });
  },
});
