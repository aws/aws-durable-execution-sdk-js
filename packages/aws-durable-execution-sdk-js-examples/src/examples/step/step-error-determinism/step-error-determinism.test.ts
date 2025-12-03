import { handler } from "./step-error-determinism";
import historyEvents from "./step-error-determinism.history.json";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "step-error-determinism test",
  functionName: "step-error-determinism",
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should have deterministic error handling behavior through replay", async () => {
      const execution = await runner.run();

      const result = execution.getResult();

      expect(result).toBe(true);

      assertEventSignatures(execution.getHistoryEvents(), historyEvents);
    });
  },
});
