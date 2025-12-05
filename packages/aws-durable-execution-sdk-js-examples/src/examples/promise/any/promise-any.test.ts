import { handler } from "./promise-any";
import historyEventsSuccess from "./promise-any-success.history.json";
import historyEventsFail from "./promise-any-failure.history.json";
import { createTests } from "../../../utils/test-helper";

createTests<string>({
  name: "promise-any test",
  functionName: "promise-any",
  handler,
  localRunnerConfig: {
    // Time-skipping results in extra retries, since retry timers will finish
    // Instantly. Disabling time-skipping to stabilize the number of retries.
    skipTime: false,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("should return first successful promise result", async () => {
      const execution = await runner.run();

      expect(execution.getOperations()).toHaveLength(4);

      const result = execution.getResult();
      expect(result).toBe("first success");

      assertEventSignatures(execution.getHistoryEvents(), historyEventsSuccess);
    });

    it("should fail if all promises fail - failure case", async () => {
      const execution = await runner.run({
        payload: {
          shouldFail: true,
        },
      });

      expect(execution.getError()).toEqual({
        errorMessage: "All promises were rejected",
        errorType: "StepError",
        errorData: undefined,
        stackTrace: undefined,
      });
      expect(execution.getOperations()).toHaveLength(4);

      assertEventSignatures(execution.getHistoryEvents(), historyEventsFail);
    });
  },
});
