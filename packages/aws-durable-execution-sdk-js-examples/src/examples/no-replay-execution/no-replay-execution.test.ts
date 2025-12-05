import {
  OperationType,
  OperationStatus,
  ExecutionStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./no-replay-execution";
import historyEvents from "./no-replay-execution.history.json";
import { createTests } from "../../utils/test-helper";

createTests({
  name: "no-replay-execution test",
  functionName: "no-replay-execution",
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should handle step operations when no replay occurs", async () => {
      const result = await runner.run();

      // Verify final result
      expect(result.getResult()).toEqual({ completed: true });

      // Get step operations
      const user1Step = runner.getOperation("fetch-user-1");
      const user2Step = runner.getOperation("fetch-user-2");

      // Verify first-time execution tracking (no replay)
      expect(user1Step.getType()).toBe(OperationType.STEP);
      expect(user1Step.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(user1Step.getStepDetails()?.result).toEqual("user-1");

      expect(user2Step.getType()).toBe(OperationType.STEP);
      expect(user2Step.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(user2Step.getStepDetails()?.result).toEqual("user-2");

      // Verify both operations tracked
      expect(result.getOperations()).toHaveLength(2);

      // Verify no error occurred
      expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      assertEventSignatures(result.getHistoryEvents(), historyEvents);
    });
  },
});
