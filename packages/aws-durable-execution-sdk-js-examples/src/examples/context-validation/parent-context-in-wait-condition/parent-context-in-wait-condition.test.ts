import { handler } from "./parent-context-in-wait-condition";
import { createTests } from "../../../utils/test-helper";
import {
  ExecutionStatus,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";

// Set shorter timeout for context validation tests since they should fail quickly
jest.setTimeout(5000);

createTests({
  name: "context validation - parent context in wait condition error",
  functionName: "parent-context-in-wait-condition",
  handler,
  tests: (runner) => {
    it("should fail when using parent context inside waitForCondition", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe(ExecutionStatus.FAILED);
      expect(execution.getError()?.errorMessage).toContain(
        "Context usage error",
      );
      expect(execution.getError()?.errorMessage).toContain(
        "You are using a parent or sibling context",
      );

      const operations = execution.getOperations();

      // The nested-wrong-step should NOT exist because validation should prevent it
      const nestedWrongStepOp = operations.find(
        (op: any) => op.getName() === "nested-wrong-step",
      );
      expect(nestedWrongStepOp).toBeUndefined();
    });
  },
});
