import { handler } from "./wait-for-condition";
import historyEvents from "./wait-for-condition.history.json";
import { createTests } from "../../utils/test-helper";

createTests({
  name: "wait-for-condition test",
  functionName: "wait-for-condition",
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should invoke step three times before succeeding", async () => {
      const execution = await runner.run();
      expect(execution.getResult()).toStrictEqual(3);

      assertEventSignatures(execution.getHistoryEvents(), historyEvents);
    });
  },
});
