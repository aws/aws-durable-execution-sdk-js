import {
  OperationStatus,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./pause-resume";
import { createTests } from "../../utils/test-helper";

/** Whether `promise` settles within a short window. */
const settlesSoon = (promise: Promise<unknown>): Promise<boolean> =>
  Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200)),
  ]);

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("suspends an invocation paused mid-step and continues it after resume", async () => {
      const executionPromise = runner.run({ payload: { orderId: "order-7" } });

      // Pause while "reserve-stock" is running. pauseExecution() resolves once the
      // invocation has stopped, which is when the step checkpoints its result.
      const reserveStock = runner.getOperation("reserve-stock");
      await reserveStock.waitForData(WaitingOperationStatus.STARTED);
      await runner.pauseExecution();

      // The step's result was kept, but the invocation stopped there: the approval was
      // never requested, and the execution does not finish while paused.
      expect(reserveStock.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(
        runner.getOperation("manager-approval").getStatus(),
      ).toBeUndefined();
      expect(await settlesSoon(executionPromise)).toBe(false);

      // Resuming starts a new invocation, which replays "reserve-stock" from its checkpoint
      // and carries on to the approval.
      await runner.resumeExecution();
      const approval = runner.getOperation("manager-approval");
      await approval.waitForData(WaitingOperationStatus.SUBMITTED);
      await approval.sendCallbackSuccess("approved");

      const execution = await executionPromise;

      expect(execution.getResult()).toEqual({
        reservation: "reserved-order-7",
        approval: "approved",
        shipment: "shipped-order-7",
      });

      assertEventSignatures(execution, "mid-step");
    });

    it("holds back the invocation a callback would start until resumed", async () => {
      const executionPromise = runner.run({ payload: { orderId: "order-8" } });

      const approval = runner.getOperation("manager-approval");
      await approval.waitForData(WaitingOperationStatus.SUBMITTED);

      // Nothing is running while the workflow waits for its approval, so this resolves
      // straight away. The callback can still be sent while paused, but the invocation it
      // would start is held back.
      await runner.pauseExecution();
      await approval.sendCallbackSuccess("approved");

      expect(await settlesSoon(executionPromise)).toBe(false);
      expect(runner.getOperation("ship-order").getStatus()).toBeUndefined();

      await runner.resumeExecution();
      const execution = await executionPromise;

      expect(execution.getResult()).toEqual({
        reservation: "reserved-order-8",
        approval: "approved",
        shipment: "shipped-order-8",
      });

      assertEventSignatures(execution, "waiting-for-callback");
    });
  },
});
