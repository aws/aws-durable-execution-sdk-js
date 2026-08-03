import { handler } from "./with-retry-linear-strategy";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should retry with linear backoff and succeed on the third attempt", async () => {
      const execution = await runner.run({ payload: { succeedOnAttempt: 3 } });

      // Attempts 1 and 2 fail, attempt 3 succeeds. The linear strategy issued
      // two backoff waits (1s then 2s) between the three attempts. The exact
      // sequence of durable events (child context + backoff waits + success)
      // is validated by assertEventSignatures against the recorded history.
      expect(execution.getResult()).toEqual({
        message: "request confirmed on attempt 3",
        attempts: 3,
      });

      assertEventSignatures(execution);
    });
  },
});
