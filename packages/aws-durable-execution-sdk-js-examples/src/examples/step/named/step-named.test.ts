import { handler } from "./step-named";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    const DEFAULT = "default";

    const getExpectedResult = (input: any) => `processed: ${input}`;

    it("should return default data if no input", async () => {
      const execution = await runner.run();

      expect(execution.getResult()).toStrictEqual(getExpectedResult(DEFAULT));

      assertEventSignatures(execution);
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
        getExpectedResult(INPUT.data),
      );

      assertEventSignatures(execution);
    });

    it("named step should return correct result", async () => {
      const execution = await runner.run();

      expect(
        runner.getOperation("process-data").getStepDetails()?.result,
      ).toStrictEqual(getExpectedResult(DEFAULT));

      assertEventSignatures(execution);
    });
  },
});
