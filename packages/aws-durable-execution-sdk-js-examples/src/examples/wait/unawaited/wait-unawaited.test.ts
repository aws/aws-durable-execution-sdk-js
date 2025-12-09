import {
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-unawaited";
import { createTests } from "../../../utils/test-helper";

createTests({
  localRunnerConfig: {
    skipTime: false,
  },
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should not hang if a long wait is scheduled before the function completes", async () => {
      const execution = await runner.run();

      // Get the wait operation that was scheduled
      const waitOperation = runner.getOperationByIndex(0);

      // Verify function completed successfully
      expect(execution.getResult()).toBe("result");

      // Verify the wait operation was scheduled correctly
      expect(waitOperation.getType()).toBe(OperationType.WAIT);
      expect(waitOperation.getStatus()).toBe(OperationStatus.STARTED);

      // Verify the wait duration is 1 day (86400 seconds)
      expect(waitOperation.getWaitDetails()?.waitSeconds).toBe(86400);

      // Verify we have exactly one operation
      const completedOperations = execution.getOperations();
      expect(completedOperations.length).toEqual(1);

      assertEventSignatures(execution);
    });
  },
});
