import { handler } from "./batch-result-error-determinism";
import { createTests } from "../../utils/test-helper";

interface TestResult {
  initialCauseIsCustomError: boolean;
  replayCauseIsCustomError: boolean;
  areEqual: boolean;
}

createTests<TestResult>({
  name: "batch-result-error-determinism test",
  functionName: "batch-result-error-determinism",
  handler,
  localRunnerConfig: {
    skipTime: false,
  },
  tests: (runner) => {
    it("should demonstrate proper error reconstruction in BatchResult", async () => {
      const execution = await runner.run();

      const result = execution.getResult();

      console.log("Test result:", result);

      expect(result).toBeDefined();
      expect(result!.areEqual).toBe(true); // Errors are deterministic
      expect(result!.initialCauseIsCustomError).toBe(false); // CustomError cause becomes generic Error
      expect(result!.replayCauseIsCustomError).toBe(false); // Both lose CustomError type consistently
    }, 30000);
  },
});
