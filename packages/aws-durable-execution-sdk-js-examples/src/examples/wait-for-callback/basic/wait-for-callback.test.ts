import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-for-callback";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { isCloud }) => {
    it("function completes when callback succeeds - happy case", async () => {
      const executionPromise = runner.run();

      const waitForCallbackOp = runner.getOperationByIndex(0);
      await waitForCallbackOp.waitForData(WaitingOperationStatus.STARTED);
      await waitForCallbackOp.sendCallbackSuccess("succeeded");

      const execution = await executionPromise;

      expect(execution.getResult()).toEqual("succeeded");
    });

    it("function completes when callback fails - happy case", async () => {
      const executionPromise = runner.run();

      const waitForCallbackOp = runner.getOperationByIndex(0);
      await waitForCallbackOp.waitForData(WaitingOperationStatus.STARTED);
      await waitForCallbackOp.sendCallbackFailure({ ErrorMessage: "ERROR" });

      const execution = await executionPromise;

      expect(execution.getError()).toBeDefined();
    });

    // TODO: fix testing lib local runner time scaling to handle timeouts better
    if (isCloud) {
      it("function times out when callback is not called - failure case", async () => {
        const execution = await runner.run();

        expect(execution.getError()).toBeDefined();
      });
    }
  },
});
