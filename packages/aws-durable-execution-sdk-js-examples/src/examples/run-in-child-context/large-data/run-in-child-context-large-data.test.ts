import { handler } from "./run-in-child-context-large-data";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "run-in-child-context-large-data test",
  functionName: "run-in-child-context-large-data",
  handler,
  localRunnerConfig: {
    skipTime: true, // Skip wait delays for faster testing
  },
  tests: (runner) => {
    it("should handle large data exceeding 256k limit using runInChildContext", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Verify the execution succeeded
      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(result.success).toBe(true);

      // Verify large data was processed
      expect(result.summary.totalDataSize).toBeGreaterThan(240); // Should be ~250KB
      expect(result.summary.stepsExecuted).toBe(5);
      expect(result.summary.childContextUsed).toBe(true);
      expect(result.summary.waitExecuted).toBe(true);
      expect(result.summary.dataPreservedAcrossWait).toBe(true);

      // Verify data integrity across wait
      expect(result.dataIntegrityCheck).toBe(true);
    });
  },
});
