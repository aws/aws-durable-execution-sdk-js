import { handler } from "./hello-world";
import { createTests } from "../../utils/test-helper";

createTests({
  name: "hello-world test",
  functionName: "hello-world",
  handler,
  tests: (runner) => {
    it("should return as expected with no operations", async () => {
      const execution = await runner.run();

      expect(execution.getResult()).toEqual("Hello World!");
      expect(execution.getOperations()).toHaveLength(0);
    });
  },
});
