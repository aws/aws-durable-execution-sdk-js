import { handler } from "./run-in-child-context-failing-step";
import historyEvents from "./run-in-child-context-failing-step.history.json";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "run-in-child-context-failing-step",
  functionName: "run-in-child-context-failing-step",
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should succeed despite failing step in child context", async () => {
      const execution = await runner.run();
      const result = execution.getResult();

      expect(result).toStrictEqual({ success: true });

      assertEventSignatures(execution.getHistoryEvents(), historyEvents);
    });
  },
});
