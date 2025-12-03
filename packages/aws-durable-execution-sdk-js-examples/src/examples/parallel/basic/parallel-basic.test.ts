import { handler } from "./parallel-basic";
import historyEvents from "./parallel-basic.history.json";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "parallel-basic test",
  functionName: "parallel-basic",
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should run correct number of durable steps", async () => {
      const execution = await runner.run();

      expect(runner.getOperation("parallel").getChildOperations()).toHaveLength(
        3,
      );
    });

    it("should return correct result", async () => {
      const execution = await runner.run();

      const result = execution.getResult();

      expect(execution.getResult()).toBeDefined();

      assertEventSignatures(execution.getHistoryEvents(), historyEvents);
    });
  },
});
