import { handler } from "./wait-for-condition";
import { createTests } from "../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should invoke step three times before succeeding", async () => {
      const execution = await runner.run();
      expect(execution.getResult()).toStrictEqual(3);

      assertEventSignatures(execution);
    });
  },
});
