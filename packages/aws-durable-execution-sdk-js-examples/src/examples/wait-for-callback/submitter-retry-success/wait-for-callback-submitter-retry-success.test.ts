import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-for-callback-submitter-retry-success";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should complete successfully when submitter succeeds", async () => {
      const executionPromise = runner.run({ payload: { shouldFail: false } });

      const waitForCallbackOp = runner.getOperationByIndex(0);
      await waitForCallbackOp.waitForData(WaitingOperationStatus.SUBMITTED);
      await waitForCallbackOp.sendCallbackSuccess(
        JSON.stringify({ data: "completed" }),
      );

      const execution = await executionPromise;

      expect(execution.getResult()).toEqual({
        result: JSON.stringify({ data: "completed" }),
        success: true,
      });

      assertEventSignatures(execution, "success");
    });

    it("should fail after exhausting retries when submitter always fails", async () => {
      const execution = await runner.run({ payload: { shouldFail: true } });

      const error = execution.getError();
      expect(error).toBeDefined();
      expect(error?.errorMessage).toContain("Simulated submitter failure");

      assertEventSignatures(execution, "failure");
    });
  },
});
