import { handler } from "./parent-context-in-child";
import { createTests } from "../../../utils/test-helper";

// Set shorter timeout for context validation tests since they should fail quickly
jest.setTimeout(5000);

createTests({
  name: "context validation - parent context in child error",
  functionName: "parent-context-in-child",
  handler,
  tests: (runner) => {
    it("should fail when using parent context directly in child", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe("FAILED");
      expect(execution.getError()?.errorMessage).toContain(
        "Context usage error",
      );
      expect(execution.getError()?.errorMessage).toContain(
        "You are using a parent or sibling context",
      );

      const operations = execution.getOperations();

      // The child-context operation is now properly persisted before error occurs,
      // thanks to waitForQueueCompletion. This ensures the checkpoint is saved
      // regardless of the events that happens after that
      expect(operations).toHaveLength(1);
      expect(operations[0].getName()).toBe("child-context");
      expect(operations[0].getStatus()).toBe("STARTED");
    });
  },
});
