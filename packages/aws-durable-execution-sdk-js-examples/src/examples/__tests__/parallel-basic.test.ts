import { handler } from "../parallel-basic";
import { createTests } from "./shared/test-helper";

createTests({
  name: "parallel-basic test",
  functionName: "parallel-basic",
  handler,
  tests: (runner) => {
    it("should run correct number of durable steps", async () => {
      const execution = await runner.run();

      expect(runner.getOperation("parallel").getChildOperations()).toHaveLength(
        3
      );
    });

    it("should return correct result", async () => {
      const execution = await runner.run();

      const result = execution.getResult();

      expect(execution.getResult()).toBeDefined();
    });
  },
});
