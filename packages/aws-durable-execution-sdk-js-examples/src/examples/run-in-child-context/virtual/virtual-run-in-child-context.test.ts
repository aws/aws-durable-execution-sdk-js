import { handler } from "./virtual-run-in-child-context";
import { createTests } from "../../../utils/test-helper";
import {
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";

createTests({
  handler,
  localRunnerConfig: {
    skipTime: true,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("should return correct result from virtual context", async () => {
      const execution = await runner.run();

      expect(execution.getResult()).toBe("virtual child step completed");
    });

    it("should not create context operation for virtual context", async () => {
      const execution = await runner.run();

      // Virtual contexts should not create CONTEXT operations
      const operations = execution.getOperations();
      const contextOperations = operations.filter(
        (op) => op.getType() === OperationType.CONTEXT,
      );

      // Should have 0 context operations (virtual context skips checkpointing)
      expect(contextOperations).toHaveLength(0);

      // Should still have the step operation
      const stepOperations = operations.filter(
        (op) => op.getType() === OperationType.STEP,
      );
      expect(stepOperations).toHaveLength(1);
      expect(stepOperations[0].getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(stepOperations[0].getStepDetails()?.result).toBe(
        "virtual child step completed",
      );
    });

    it("should execute child step without parent context tracking", async () => {
      const execution = await runner.run();

      // Verify final result
      expect(execution.getResult()).toBe("virtual child step completed");

      // Verify only step operation exists (no parent context operation)
      const operations = execution.getOperations();
      expect(operations.length).toEqual(1);

      const stepOp = operations[0];
      expect(stepOp.getType()).toBe(OperationType.STEP);
      expect(stepOp.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(stepOp.getStepDetails()?.result).toEqual(
        "virtual child step completed",
      );

      assertEventSignatures(execution);
    });
  },
});
