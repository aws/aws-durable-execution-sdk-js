import { handler } from "../step-basic";
import { createTests } from "./shared/test-helper";

createTests({
  name: "step-basic test",
  functionName: "step-basic",
  handler,
  tests: (runner) => {
    it("should execute step and return correct result", async () => {
      const execution = await runner.run();

      expect(execution.getOperations()).toHaveLength(1);
      expect(execution.getResult()).toStrictEqual("step completed");
    });
  },
});
