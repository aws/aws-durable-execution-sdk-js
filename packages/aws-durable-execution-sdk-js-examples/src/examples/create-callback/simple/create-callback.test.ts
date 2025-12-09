import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./create-callback";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    it("function completes when callback succeeds - happy case", async () => {
      const res = "successful";
      const executionPromise = runner.run();

      const callbackOp = runner.getOperationByIndex(0);
      await callbackOp.waitForData(WaitingOperationStatus.STARTED);
      await callbackOp.sendCallbackSuccess(res);

      const execution = await executionPromise;

      expect(callbackOp.getCallbackDetails()?.result).toStrictEqual(res);
      expect(execution.getResult()).toStrictEqual(res);
    });

    it("function completes when callback fails - happy case", async () => {
      const executionPromise = runner.run();

      const callbackOp = runner.getOperationByIndex(0);
      await callbackOp.waitForData(WaitingOperationStatus.STARTED);
      await callbackOp.sendCallbackFailure({ ErrorMessage: "ERROR" });

      const execution = await executionPromise;

      expect(callbackOp.getCallbackDetails()?.error).toBeDefined();
      expect(execution.getError()).toBeDefined();
    });

    it("function completes when callback succeeds with undefined - edge case", async () => {
      const executionPromise = runner.run();

      const callbackOp = runner.getOperationByIndex(0);
      await callbackOp.waitForData(WaitingOperationStatus.STARTED);
      await callbackOp.sendCallbackSuccess(undefined);

      const execution = await executionPromise;

      expect(callbackOp.getCallbackDetails()?.result).toBeUndefined();
      expect(callbackOp.getCallbackDetails()?.error).toBeUndefined();
      expect(execution.getResult()).toBeUndefined();
    });

    it("function completes when callback fails with undefined error message - edge case", async () => {
      const executionPromise = runner.run();

      const callbackOp = runner.getOperationByIndex(0);
      await callbackOp.waitForData(WaitingOperationStatus.STARTED);
      await callbackOp.sendCallbackFailure(undefined);

      const execution = await executionPromise;

      expect(callbackOp.getCallbackDetails()?.result).toBeUndefined();
      expect(callbackOp.getCallbackDetails()?.error).toStrictEqual({
        errorData: undefined,
        errorMessage: undefined,
        errorType: undefined,
        stackTrace: undefined,
      });
      expect(execution.getError()).toBeDefined();
    });
  },
});
