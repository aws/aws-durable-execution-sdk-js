import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./with-retry-invoke";
import { handler as targetHandler } from "./with-retry-invoke-target";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { functionNameMap, assertEventSignatures }) => {
    it("should retry the invoke until the target succeeds on the final attempt", async () => {
      const maxAttempts = 3;
      const failUntilAttempt = 3;

      if (runner instanceof LocalDurableTestRunner) {
        runner.registerDurableFunction(
          functionNameMap.getFunctionName("with-retry-invoke-target"),
          targetHandler,
        );
      }

      const execution = await runner.run({
        payload: {
          functionName: functionNameMap.getFunctionName(
            "with-retry-invoke-target",
          ),
          failUntilAttempt,
          maxAttempts,
        },
      });

      expect(execution.getResult()).toEqual({
        result: { attempt: maxAttempts, success: true },
        attempts: maxAttempts,
      });

      assertEventSignatures(execution);
    });
  },
});
