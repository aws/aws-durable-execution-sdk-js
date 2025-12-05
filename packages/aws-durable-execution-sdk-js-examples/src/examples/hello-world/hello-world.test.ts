import { handler } from "./hello-world";
import historyEvents from "./hello-world.history.json";
import { createTests } from "../../utils/test-helper";

createTests({
  name: "hello-world test",
  functionName: "hello-world",
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should return as expected with no operations", async () => {
      const execution = await runner.run();

      expect(execution.getResult()).toEqual("Hello World!");
      expect(execution.getOperations()).toHaveLength(0);

      assertEventSignatures(execution.getHistoryEvents(), historyEvents);
    });
  },
});
