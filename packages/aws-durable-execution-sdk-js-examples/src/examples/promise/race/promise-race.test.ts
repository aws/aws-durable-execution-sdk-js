import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./promise-race";
import historyEvents from "./promise-race.history.json";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "promise-race test",
  functionName: "promise-race",
  handler,
  tests: (runner, { assertEventSignatures, isCloud }) => {
    it("should complete all promises", async () => {
      const execution = await runner.run({
        payload: {
          isCloud,
        },
      });

      // we can't expect all promises to complete here as promise race will resolve
      // as soon as one of the promises resolves
      const promiseRaceOp = runner.getOperation("promise-race");
      expect(promiseRaceOp.getStatus()).toStrictEqual(
        OperationStatus.SUCCEEDED,
      );
      expect(promiseRaceOp.getStepDetails()?.result).toBeDefined();

      expect(execution.getResult()).toStrictEqual("fast result");

      assertEventSignatures(execution.getHistoryEvents(), historyEvents);
    });
  },
});
