import { handler } from "./parent-context-in-step";
import { createTests } from "../../../utils/test-helper";

// Set shorter timeout for context validation tests since they should fail quickly
jest.setTimeout(5000);

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should fail when using parent context inside step function", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe("FAILED");
      expect(execution.getError()?.errorMessage).toContain(
        "Context usage error",
      );
      expect(execution.getError()?.errorMessage).toContain(
        "You are using a parent or sibling context",
      );

      const operations = execution.getOperations();

      // Should have the child context operation that was in progress when terminated
      const childContextOp = operations.find(
        (op: any) => op.getName() === "child-context",
      );
      expect(childContextOp).toBeDefined();
      expect(childContextOp?.getStatus()).toBe("STARTED");

      // Should have the correct step that succeeded before the validation error
      const correctStep = operations.find(
        (op: any) => op.getName() === "correct-step",
      );
      expect(correctStep).toBeDefined();
      expect(correctStep?.getStatus()).toBe("SUCCEEDED");

      // The step-with-invalid-nested may or may not exist depending on environment
      // In local tests, it exists with STARTED status
      // In cloud/Step Functions, it might not be recorded if validation fails immediately
      const stepWithInvalidNested = operations.find(
        (op: any) => op.getName() === "step-with-invalid-nested",
      );
      if (stepWithInvalidNested) {
        expect(stepWithInvalidNested.getStatus()).toBe("STARTED");
      }

      // The nested invalid-nested-step should NOT exist anywhere
      // 1. Should not exist at root level
      const invalidNestedStepAtRoot = operations.find(
        (op: any) => op.getName() === "invalid-nested-step",
      );
      expect(invalidNestedStepAtRoot).toBeUndefined();

      // 2. Should not exist inside the parent step-with-invalid-nested (if it exists)
      if (stepWithInvalidNested) {
        const childOpsOfStepWithInvalidNested = operations.filter(
          (op: any) => op.getParentId() === stepWithInvalidNested.getId(),
        );
        const invalidNestedStepInParent = childOpsOfStepWithInvalidNested.find(
          (op: any) => op.getName() === "invalid-nested-step",
        );
        expect(invalidNestedStepInParent).toBeUndefined();
      }

      // The wait operation after runInChildContext should NOT exist - execution terminated
      const shouldNotStartWait = operations.find(
        (op: any) => op.getName() === "should-not-start",
      );
      expect(shouldNotStartWait).toBeUndefined();

      // Should have at least child-context and correct-step
      // May also have step-with-invalid-nested in local tests
      expect(operations.length).toBeGreaterThanOrEqual(2);
      expect(operations.length).toBeLessThanOrEqual(3);

      assertEventSignatures(execution);
    });
  },
});
