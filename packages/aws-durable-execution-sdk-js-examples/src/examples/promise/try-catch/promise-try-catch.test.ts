import { handler } from "./promise-try-catch";
import { createTests } from "../../../utils/test-helper";

interface PromiseTryCatchResult {
  result: string;
  errorCaught: boolean;
}

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should catch PromiseCombinatorError from context.promise.all", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as PromiseTryCatchResult;

      // Execution should succeed despite the error being caught
      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getOperations()).toHaveLength(4); // 3 steps + 1 promise.all

      // Error should be caught and handled
      expect(result.errorCaught).toBe(true);
      expect(result.result).toContain("caught PromiseCombinatorError:");

      // Check individual step statuses
      expect(runner.getOperation("step-1").getStatus()).toBe("SUCCEEDED");
      expect(runner.getOperation("step-2").getStatus()).toBe("FAILED");
      expect(runner.getOperation("step-3").getStatus()).toBe("SUCCEEDED");

      assertEventSignatures(execution);
    });
  },
});
