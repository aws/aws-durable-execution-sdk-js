import { handler } from "../step-named";
import { createTests } from "./shared/test-helper";

createTests({
  name: "step-named test",
  functionName: "step-named",
  handler,
  tests: (runner) => {
    const DEFAULT = "default";

    const getExpectedResult = (input: any) => `processed: ${input}`;

    it("should return default data if no input", async () => {
      const execution = await runner.run();

      expect(execution.getResult()).toStrictEqual(getExpectedResult(DEFAULT));
    });

    it("should return provided input", async () => {
      const INPUT = {
        data: {
          foo: "bar",
        },
      };

      const execution = await runner.run({
        payload: INPUT,
      });

      expect(execution.getResult()).toStrictEqual(
        getExpectedResult(INPUT.data)
      );
    });

    it("named step should return correct result", async () => {
      const execution = await runner.run();

      expect(
        runner.getOperation("process-data").getStepDetails()?.result
      ).toStrictEqual(getExpectedResult(DEFAULT));
    });
  },
});
