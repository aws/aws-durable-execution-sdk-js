import {
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./multiple-waits";
import { createTests } from "../../utils/test-helper";

createTests({
  name: "multiple-waits test",
  functionName: "multiple-waits",
  handler,
  tests: (runner) => {
    it("should handle multiple sequential wait operations", async () => {
      const firstWait = runner.getOperation("wait-1");
      const secondWait = runner.getOperation("wait-2");

      const result = await runner.run();

      expect(result.getResult()).toEqual({
        completedWaits: 2,
        finalStep: "done",
      });

      // Verify operations were tracked
      const operations = result.getOperations();
      expect(operations.length).toEqual(2);

      // Verify operation data can be accessed
      expect(firstWait.getType()).toBe(OperationType.WAIT);
      expect(firstWait.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(secondWait.getType()).toBe(OperationType.WAIT);
      expect(secondWait.getStatus()).toBe(OperationStatus.SUCCEEDED);

      // Verify operation details for both wait operations
      expect(firstWait.getWaitDetails()?.waitSeconds).toBe(5);
      expect(firstWait.getWaitDetails()?.scheduledEndTimestamp).toBeInstanceOf(
        Date,
      );
      expect(secondWait.getWaitDetails()?.waitSeconds).toBe(5);
      expect(secondWait.getWaitDetails()?.scheduledEndTimestamp).toBeInstanceOf(
        Date,
      );
    });
  },
});
