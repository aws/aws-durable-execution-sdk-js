import { handler } from "./promise-all-settled";
import historyEvents from "./promise-all-settled.history.json";
import { createTests } from "../../../utils/test-helper";

createTests<PromiseSettledResult<any>[]>({
  name: "promise-all-settled test",
  functionName: "promise-all-settled",
  handler,
  localRunnerConfig: {
    skipTime: false,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("should complete all promises", async () => {
      const execution = await runner.run();

      expect(execution.getOperations()).toHaveLength(4);

      const result = execution.getResult();

      expect(result).toStrictEqual([
        {
          status: "fulfilled",
          value: "success",
        },
        {
          status: "rejected",
          reason: {
            name: "StepError",
          },
        },
        {
          status: "fulfilled",
          value: "another success",
        },
      ]);

      assertEventSignatures(execution.getHistoryEvents(), historyEvents);
    }, 30000);
  },
});
