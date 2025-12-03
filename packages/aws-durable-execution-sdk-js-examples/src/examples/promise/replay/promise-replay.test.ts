import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./promise-replay";
import historyEvents from "./promise-replay.history.json";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "promise-replay",
  functionName: "promise-replay",
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should replay promises correctly", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      expect(execution.getResult()).toStrictEqual({
        successStep: "Success",
      });

      assertEventSignatures(execution.getHistoryEvents(), historyEvents);
    });
  },
});
