import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-for-callback";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("function completes when callback succeeds - happy case", async () => {
      const executionPromise = runner.run();

      const waitForCallbackOp = runner.getOperationByIndex(0);
      await waitForCallbackOp.waitForData(WaitingOperationStatus.SUBMITTED);
      await waitForCallbackOp.sendCallbackSuccess("succeeded");

      const execution = await executionPromise;

      expect(execution.getResult()).toEqual("succeeded");

      assertEventSignatures(execution, "success");
    });

    it("function completes when callback fails - happy case", async () => {
      const executionPromise = runner.run();

      const waitForCallbackOp = runner.getOperationByIndex(0);
      await waitForCallbackOp.waitForData(WaitingOperationStatus.SUBMITTED);
      await waitForCallbackOp.sendCallbackFailure({ ErrorMessage: "ERROR" });

      const execution = await executionPromise;

      expect(execution.getError()).toBeDefined();

      assertEventSignatures(execution, "failure");
    });

    it("function times out when callback is not called - failure case", async () => {
      const execution = await runner.run({
        payload: {
          timeoutSeconds: 1,
        },
      });

      expect(execution.getError()).toBeDefined();

      assertEventSignatures(execution, "timed-out");
    });
  },
});
