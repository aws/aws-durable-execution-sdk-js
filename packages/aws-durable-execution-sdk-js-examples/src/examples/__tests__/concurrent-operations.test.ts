import { handler } from "../concurrent-operations";
import { createTests } from "./shared/test-helper";

createTests({
  name: "concurrent-operations test",
  functionName: "concurrent-operations",
  localRunnerConfig: {
    skipTime: false,
  },
  handler,
  tests: (runner) => {
    it("should handle promise.all correctly", async () => {
      const execution = await runner.run();

      expect(execution.getResult()).toEqual(["task 1 result", "task 2 result"]);

      expect(execution.getOperations()).toHaveLength(7);

      const block1 = runner.getOperation("block-1");
      expect(block1.getContextDetails()?.result).toStrictEqual("task 1 result");
      expect(block1.getChildOperations()).toHaveLength(2);

      const block2 = runner.getOperation("block-2");
      expect(block2.getContextDetails()?.result).toStrictEqual("task 2 result");
      expect(block2.getChildOperations()).toHaveLength(2);
    }, 10000);
  },
});
