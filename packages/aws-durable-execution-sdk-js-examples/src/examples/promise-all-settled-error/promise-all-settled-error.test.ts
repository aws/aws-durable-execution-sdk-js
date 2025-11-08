import { handler } from "./promise-all-settled-error";
import { createTests } from "../../utils/test-helper";

createTests<boolean>({
  name: "promise-all-settled test",
  functionName: "promise-all-settled",
  handler,
  localRunnerConfig: {
    skipTime: false,
  },
  tests: (runner) => {
    it("should maintain error determinism - both checks should return the same value", async () => {
      const execution = await runner.run();

      const result = execution.getResult();

      // Both error instanceof checks should return the same value (true)
      // demonstrating that StepError type is preserved through replay
      expect(result).toBe(true);
    }, 30000);
  },
});
