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

      // With waitForQueueCompletion, operations that start are now properly persisted
      // even when validation fails later, which is the correct behavior

      // The child-context operation should exist and be in STARTED state
      const childContextOp = operations.find(
        (op: any) => op.getName() === "child-context",
      );
      expect(childContextOp).toBeDefined();
      expect(childContextOp!.getStatus()).toBe(OperationStatus.STARTED);

      // The wrong wait condition should exist since it started before validation failed
      const wrongWaitOp = operations.find(
        (op: any) => op.getName() === "wrong-wait-condition",
      );
      expect(wrongWaitOp).toBeDefined();
      expect(wrongWaitOp!.getStatus()).toBe(OperationStatus.STARTED);

      // The nested wrong step should NOT exist anywhere
      // 1. Should not exist at root level
      const nestedWrongStepAtRoot = operations.find(
        (op: any) => op.getName() === "nested-wrong-step",
      );
      expect(nestedWrongStepAtRoot).toBeUndefined();

      // 2. Should not exist inside wrong-wait-condition (which itself doesn't exist)
      // But let's be thorough and check no operation has it as a child
      const nestedWrongStepAsChild = operations.find(
        (op: any) => op.getName() === "nested-wrong-step" && op.getParentId(),
      );
      expect(nestedWrongStepAsChild).toBeUndefined();

      // The wait operation after runInChildContext should NOT exist - execution terminated
      const shouldNotStartWait = operations.find(
        (op: any) => op.getName() === "should-not-start",
      );
      expect(shouldNotStartWait).toBeUndefined();

      // Should have exactly 2 operations: child-context and wrong-wait-condition
      expect(operations.length).toBe(2);
    });
  },
});
