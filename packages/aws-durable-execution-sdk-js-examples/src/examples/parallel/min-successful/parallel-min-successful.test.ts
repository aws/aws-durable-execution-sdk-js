import { handler } from "./parallel-min-successful";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "Parallel minSuccessful",
  functionName: "parallel-min-successful",
  handler,
  tests: (runner) => {
    it("should complete early when minSuccessful is reached", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      expect(result.successCount).toBe(2);
      expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
      expect(result.results).toHaveLength(2);
      expect(result.totalCount).toBe(4);
    });
  },
});
