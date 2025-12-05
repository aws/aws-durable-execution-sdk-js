import { handler } from "./run-in-child-context-checkpoint-size-limit";
import historyEvents from "./run-in-child-context-checkpoint-size-limit.history.json";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "run-in-child-context-checkpoint-size-limit boundary test",
  functionName: "run-in-child-context-checkpoint-size-limit",
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should handle 100 iterations near checkpoint size limit", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Verify the execution succeeded
      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(result.success).toBe(true);

      // Verify totalIterations matches actual operations created
      expect(result.totalIterations).toBe(
        execution.getOperations({
          status: "SUCCEEDED",
        }).length,
      );

      assertEventSignatures(execution.getHistoryEvents(), historyEvents);
    }, 120000);
  },
});
