import { handler } from "../hello-world";
import { createTests } from "./shared/test-helper";

createTests({
  name: "hello-world test",
  functionName: "hello-world",
  handler,
  tests: (runner) => {
    it("should return as expected", async () => {
      const execution = await runner.run();

      expect(execution.getResult()).toEqual("Hello World!");
    });
  },
});
