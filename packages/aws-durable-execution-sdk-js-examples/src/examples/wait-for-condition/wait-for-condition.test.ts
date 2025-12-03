import { handler } from "./wait-for-condition";
import { createTests } from "../../utils/test-helper";

createTests({
  name: "wait-for-condition test",
  functionName: "wait-for-condition",
  handler,
  tests: (runner) => {
    it("should invoke step three times before succeeding", async () => {
      const execution = await runner.run();
      expect(execution.getResult()).toStrictEqual(3);
    });
  },
});
