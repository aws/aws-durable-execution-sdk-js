import { vi } from "vitest";
import {
  OperationStatus,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./step-pause-every";
import { createTests } from "../../../utils/test-helper";

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
    it("pauses after the second failed attempt and succeeds after resume", async () => {
      const executionPromise = runner.run();

      const step = runner.getOperation("call-payment-service");
      await step.waitForData(WaitingOperationStatus.STARTED);

      // The second attempt fails, and the step pauses the execution.
      await vi.waitFor(
        () =>
          expect(
            step.getOperationData()?.StepDetails?.Error?.ErrorMessage,
          ).toBe("Payment service unavailable (attempt 2)"),
        { timeout: 5000 },
      );

      // The third attempt does not start, so the execution does not finish while paused.
      expect(await settlesSoon(executionPromise)).toBe(false);
      expect(step.getStatus()).not.toBe(OperationStatus.SUCCEEDED);

      await runner.resumeExecution();
      const execution = await executionPromise;

      expect(execution.getResult()).toBe("payment accepted");
      expect(step.getStatus()).toBe(OperationStatus.SUCCEEDED);

      assertEventSignatures(execution);
    });
  },
});
