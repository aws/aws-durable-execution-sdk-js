import { OperationType } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./block-example";
import { createTests } from "../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should execute nested child contexts with proper checkpointing", async () => {
      const execution = await runner.run();

      // Verify the final result structure
      const result = execution.getResult();
      expect(result).toEqual({
        nestedStep: "nested step result",
        nestedBlock: "nested block result",
      });

      // Check for the parent block operation
      const parentBlockOp = runner.getOperation("parent_block");
      expect(parentBlockOp.getContextDetails()?.result).toEqual({
        nestedStep: "nested step result",
        nestedBlock: "nested block result",
      });

      const childOperations = parentBlockOp.getChildOperations();
      expect(childOperations).toHaveLength(2);
      expect(childOperations![0].getStepDetails()?.result).toEqual(
        "nested step result",
      );
      expect(childOperations![1].getContextDetails()?.result).toEqual(
        "nested block result",
      );

      // Check for nested step operation
      const nestedStepOp = runner.getOperation("nested_step");
      expect(nestedStepOp.getStepDetails()?.result).toEqual(
        "nested step result",
      );

      // Check for nested block operation
      const nestedBlockOp = runner.getOperation("nested_block");
      expect(nestedBlockOp.getContextDetails()?.result).toEqual(
        "nested block result",
      );

      const completedOperations = execution.getOperations();
      const waitOp = completedOperations.find(
        (op) =>
          op.getType() === OperationType.WAIT &&
          op.getWaitDetails()?.waitSeconds === 1,
      );
      expect(waitOp).toBeDefined();

      assertEventSignatures(execution);
    });
  },
});
