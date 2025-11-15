import {
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-end-timestamp";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "wait-end-timestamp",
  functionName: "wait-end-timestamp",
  handler,
  tests: (runner) => {
    it("should wait until the specified timestamp", async () => {
      const execution = await runner.run();

      // Get operation using runner helper
      const waitOperation = runner.getOperationByIndex(0);

      // Verify final result
      expect(execution.getResult()).toBe("Function Completed");

      // Verify operations were tracked
      const completedOperations = execution.getOperations();
      expect(completedOperations.length).toEqual(1);

      // Verify operation data can be accessed
      expect(waitOperation.getType()).toBe(OperationType.WAIT);
      expect(waitOperation.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(waitOperation.getName()).toBe("scheduled-wait");
      expect(waitOperation.getWaitDetails()?.waitSeconds).toBe(5);
      expect(
        waitOperation.getWaitDetails()?.scheduledEndTimestamp,
      ).toBeInstanceOf(Date);
    });
  },
});
