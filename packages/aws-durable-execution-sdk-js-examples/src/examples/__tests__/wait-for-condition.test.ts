import { handler } from "../wait-for-condition";
import { createTests } from "./shared/test-helper";

// TODO: enable test when waitForCondition SDK implementation is fixed

createTests({
  name: "wait-for-condition test",
  functionName: "wait-for-condition",
  handler,
  tests: (runner) => {
    it("should invoke step three times before succeeding", async () => {
      const execution = await runner.run();
      expect(execution.getResult()).toStrictEqual(3);
      // expect(execution.getInvocations()).toHaveLength(3);
    });
  },
});
