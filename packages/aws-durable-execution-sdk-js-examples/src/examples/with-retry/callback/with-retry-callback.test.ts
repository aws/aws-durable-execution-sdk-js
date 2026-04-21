import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./with-retry-callback";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should retry the callback until it succeeds on the final attempt", async () => {
      const maxAttempts = 3;
      const executionPromise = runner.run({ payload: { maxAttempts } });

      // Fail the first (maxAttempts - 1) attempts, then succeed on the last.
      for (let attempt = 1; attempt < maxAttempts; attempt++) {
        const op = runner.getOperation(`approval-${attempt}`);
        await op.waitForData(WaitingOperationStatus.SUBMITTED);
        await op.sendCallbackFailure({
          ErrorMessage: `Attempt ${attempt} rejected`,
          ErrorType: "RetryableError",
        });
      }

      const finalOp = runner.getOperation(`approval-${maxAttempts}`);
      await finalOp.waitForData(WaitingOperationStatus.SUBMITTED);
      await finalOp.sendCallbackSuccess(JSON.stringify({ approved: true }));

      const execution = await executionPromise;

      expect(execution.getResult()).toEqual({
        result: JSON.stringify({ approved: true }),
        attempts: maxAttempts,
      });

      assertEventSignatures(execution);
    });
  },
});
