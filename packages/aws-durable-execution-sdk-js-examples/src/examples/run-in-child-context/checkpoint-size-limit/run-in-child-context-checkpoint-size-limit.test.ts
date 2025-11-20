import { handler } from "./run-in-child-context-checkpoint-size-limit";
import { createTests } from "../../../utils/test-helper";

const CHECKPOINT_SIZE_LIMIT = 256 * 1024;

createTests({
  name: "run-in-child-context-checkpoint-size-limit boundary test",
  functionName: "run-in-child-context-checkpoint-size-limit",
  handler,
  tests: (runner) => {
    it("should handle 100 iterations near checkpoint size limit", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Verify the execution succeeded
      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(result.success).toBe(true);

      // Verify totalIterations matches actual operations created
      expect(result.totalIterations).toBe(execution.getOperations().length);
    }, 120000);
  },
});
