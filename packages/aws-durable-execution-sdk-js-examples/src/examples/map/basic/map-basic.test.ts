import { handler } from "./map-basic";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "map-basic test",
  functionName: "map-basic",
  handler,
  tests: (runner) => {
    it("should run correct number of durable steps", async () => {
      const execution = await runner.run();

      expect(runner.getOperation("map").getChildOperations()).toHaveLength(5);
    });

    it("should return correct result", async () => {
      const execution = await runner.run();

      const result = execution.getResult();

      expect(result).toStrictEqual([1, 2, 3, 4, 5].map((e) => e * 2));
    });
  },
});
