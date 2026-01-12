import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./promise-replay";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should replay promises correctly", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      expect(execution.getResult()).toStrictEqual({
        successStep: "Success",
      });

      assertEventSignatures(execution);
    });
  },
});
